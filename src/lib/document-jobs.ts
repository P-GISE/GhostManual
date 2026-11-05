import { transaction } from "./db.ts";
import { compareDocuments } from "./documents/compare.ts";
import { documentQuestions } from "./documents/questions.ts";
import type {
  DocumentComparison,
  DocumentExtraction,
  DocumentFormat,
  DocumentSnapshot,
} from "./documents/types.ts";
import { syncManual } from "./file-sources.ts";
import { newId } from "./types.ts";
export type DocumentJob = {
  id: string;
  workspaceId: string;
  revisionId: string;
  token: string;
  format: DocumentFormat;
  bytes: Buffer;
};
export async function claimDocumentJob(): Promise<DocumentJob | null> {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(782402)");
    await db.query(
      `UPDATE document_jobs j SET status='failed',lease_token=NULL,lease_until=NULL WHERE j.status IN ('queued','processing') AND NOT EXISTS(SELECT 1 FROM sessions se JOIN workspaces w ON w.id=se.workspace_id LEFT JOIN users u ON u.id=se.user_id WHERE se.id=j.session_id AND se.workspace_id=j.workspace_id AND se.role='owner' AND se.expires_at>now() AND w.expires_at>now() AND (se.user_id IS NULL OR u.terms_agreed_at IS NOT NULL))`,
    );
    await db.query(
      "UPDATE document_jobs SET status='failed',lease_token=NULL,lease_until=NULL WHERE status='processing' AND lease_until<=now() AND attempts>=3",
    );
    if (
      (
        await db.query(
          "SELECT 1 FROM document_jobs WHERE status='processing' AND lease_until>now() LIMIT 1",
        )
      ).rowCount
    )
      return null;
    const row = (
      await db.query<{
        id: string;
        workspaceId: string;
        revisionId: string;
        format: DocumentFormat;
        bytes: Buffer;
      }>(
        `SELECT j.id,j.workspace_id AS "workspaceId",j.revision_id AS "revisionId",f.file_type AS format,f.content AS bytes FROM document_jobs j JOIN source_files f ON f.revision_id=j.revision_id JOIN workspaces w ON w.id=j.workspace_id JOIN sessions se ON se.id=j.session_id AND se.workspace_id=j.workspace_id LEFT JOIN users u ON u.id=se.user_id WHERE (j.status='queued' OR (j.status='processing' AND j.lease_until<=now())) AND j.attempts<3 AND w.expires_at>now() AND se.expires_at>now() AND se.role='owner' AND (se.user_id IS NULL OR u.terms_agreed_at IS NOT NULL) ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    const token = newId();
    await db.query(
      "UPDATE document_jobs SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '3 minutes' WHERE id=$1",
      [row.id, token],
    );
    return { ...row, token };
  });
}
export async function completeDocumentJob(
  job: DocumentJob,
  extraction: DocumentExtraction,
): Promise<boolean> {
  return transaction(async (db) => {
    // Match normal write lock order and recheck uploader authority after the long parser call.
    const workspace = await db.query(
      "SELECT id FROM workspaces WHERE id=$1 AND expires_at>now() FOR UPDATE",
      [job.workspaceId],
    );
    if (!workspace.rowCount) return false;
    const row = (
      await db.query<{ source_id: string; revision: number; current: number }>(
        `SELECT r.source_id,r.revision,s.revision AS current FROM document_jobs j JOIN source_revisions r ON r.id=j.revision_id JOIN sources s ON s.id=r.source_id JOIN sessions se ON se.id=j.session_id AND se.workspace_id=j.workspace_id LEFT JOIN users u ON u.id=se.user_id WHERE j.id=$1 AND j.workspace_id=$2 AND j.revision_id=$3 AND j.status='processing' AND j.lease_token=$4 AND j.lease_until>now() AND se.role='owner' AND se.expires_at>now() AND (se.user_id IS NULL OR u.terms_agreed_at IS NOT NULL) FOR UPDATE OF j`,
        [job.id, job.workspaceId, job.revisionId, job.token],
      )
    ).rows[0];
    if (!row) return false;
    let comparison: DocumentComparison = { status: "limit_exceeded", changes: [] };
    if (extraction.status === "ready" && extraction.snapshot) {
      if (row.revision === 1) comparison = { status: "compared", changes: [] };
      else {
        const previous = (
          await db.query<{ snapshot: DocumentSnapshot }>(
            "SELECT d.snapshot FROM document_results d JOIN source_revisions r ON r.id=d.revision_id WHERE r.source_id=$1 AND r.revision=$2 AND d.status='ready'",
            [row.source_id, row.revision - 1],
          )
        ).rows[0]?.snapshot;
        if (previous) comparison = compareDocuments(previous, extraction.snapshot);
      }
    }
    const questions =
      extraction.status === "ready" || extraction.status === "limited"
        ? row.revision > 1 && comparison.status === "limit_exceeded"
          ? [
              {
                kind: "change",
                question:
                  "이전 버전과 자동 비교할 수 없습니다. 이번 버전에서 무엇을 변경했으며, 그 이유와 확인할 점은 무엇인가요?",
                groupIndexes: [],
              },
            ]
          : documentQuestions(comparison.changes, row.revision === 1)
        : [];
    const ids = questions.map(() => newId());
    for (const [position, change] of comparison.changes.entries())
      await db.query(
        "INSERT INTO change_groups(id,workspace_id,revision_id,position,kind,sheet,range,summary) VALUES($1,$2,$3,$4,$5,NULL,$6,'{}')",
        [newId(), job.workspaceId, job.revisionId, position, change.kind, change.path],
      );
    for (const [position, question] of questions.entries())
      await db.query(
        "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,group_positions,question,source) VALUES($1,$2,$3,$4,$5,$6,$7,'rule')",
        [
          ids[position],
          job.workspaceId,
          job.revisionId,
          position,
          question.kind,
          question.groupIndexes,
          question.question,
        ],
      );
    await db.query(
      "INSERT INTO document_results(id,workspace_id,revision_id,status,reason,coverage,snapshot,comparison,question_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        newId(),
        job.workspaceId,
        job.revisionId,
        extraction.status,
        extraction.reason,
        JSON.stringify(extraction.coverage),
        extraction.snapshot,
        comparison,
        ids,
      ],
    );
    await db.query(
      "UPDATE document_jobs SET status=$2,lease_token=NULL,lease_until=NULL WHERE id=$1",
      [job.id, extraction.status],
    );
    if (row.revision === row.current) await syncManual(db, row.source_id, row.revision, null);
    return true;
  });
}
export async function runDocumentJob(
  extract: (format: DocumentFormat, bytes: Uint8Array) => Promise<DocumentExtraction>,
): Promise<boolean> {
  const job = await claimDocumentJob();
  if (!job) return false;
  let result: DocumentExtraction;
  try {
    result = await extract(job.format, job.bytes);
  } catch {
    result = {
      status: "failed",
      reason: "문서 추출에 실패했습니다. 다시 분석하거나 파일을 확인하세요.",
      snapshot: null,
      coverage: [],
    };
  }
  await completeDocumentJob(job, result);
  return true;
}
