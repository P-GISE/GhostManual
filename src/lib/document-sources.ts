import { createHash } from "node:crypto";
import { z } from "zod";
import { type DbClient, transaction } from "./db.ts";
import { reviewOcrDocuments } from "./documents/compare.ts";
import { detectDocumentFormat } from "./documents/read.ts";
import type { DocumentComparison, DocumentSnapshot } from "./documents/types.ts";
import { AppError } from "./errors.ts";
import {
  assertFileQuota,
  fileRevisionInTransaction,
  MAX_FILE_BYTES,
  syncManual,
  usedFileBytes,
} from "./file-sources.ts";
import { assertSession } from "./session.ts";
import { assertSourceWrite, sourceInTransaction, uploader } from "./sources.ts";
import { newId, type SessionContext } from "./types.ts";

export async function assertDocumentReady(db: DbClient, revisionId: string, allowLimited = true) {
  const row = (
    await db.query<{ file_type: string; status: string | null }>(
      `SELECT f.file_type,j.status FROM source_files f LEFT JOIN document_jobs j ON j.revision_id=f.revision_id WHERE f.revision_id=$1`,
      [revisionId],
    )
  ).rows[0];
  if (
    row &&
    row.file_type !== "xlsx" &&
    row.status !== "ready" &&
    !(allowLimited && row.status === "limited")
  )
    throw new AppError(
      "document_not_ready",
      409,
      "파일 추출 상태를 확인하세요. 처리 완료 전에는 이 작업을 할 수 없습니다.",
    );
  return row?.status;
}
export async function registerDocument(
  ctx: SessionContext,
  input: { title?: string; fileName: string; bytes: Uint8Array; expectedRevision?: number },
  sourceId?: string,
) {
  // Authorize before parsing untrusted containers; writes recheck under the workspace lock.
  await transaction(async (db) => {
    await assertSession(db, ctx, true);
    if (sourceId) await sourceInTransaction(db, ctx, sourceId);
  });
  if (input.bytes.length > MAX_FILE_BYTES)
    throw new AppError("file_too_large", 413, "파일은 5 MB까지 올릴 수 있습니다.");
  const format = detectDocumentFormat(input.fileName, input.bytes);
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const old = sourceId ? await sourceInTransaction(db, ctx, sourceId) : null;
    if (old && (old.kind !== "file" || old.fileType !== format))
      throw new AppError(
        "file_type_mismatch",
        422,
        "같은 자료에는 같은 형식의 파일만 올릴 수 있습니다.",
      );
    if (old && old.revision !== input.expectedRevision)
      throw new AppError("conflict", 409, "다른 곳에서 새 버전이 올라왔습니다.");
    const title = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .parse(old?.title ?? input.title);
    const text = `${title}\n${format.toUpperCase()} 업무 파일 (추출 본문은 비공개)`;
    await assertSourceWrite(db, ctx, { title, text }, !old);
    assertFileQuota(await usedFileBytes(db, ctx.workspaceId), input.bytes.length);
    const id = old?.id ?? newId(),
      revision = (old?.revision ?? 0) + 1,
      revisionId = newId();
    if (old) await db.query("UPDATE sources SET revision=$1 WHERE id=$2", [revision, id]);
    else
      await db.query(
        "INSERT INTO sources(id,workspace_id,revision,kind,file_type) VALUES($1,$2,1,'file',$3)",
        [id, ctx.workspaceId, format],
      );
    await db.query(
      `INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text,uploaded_by_name,uploaded_by_department) SELECT $1,$2,$3,$4,$5,$6,${uploader("$7")}`,
      [revisionId, ctx.workspaceId, id, revision, title, text, ctx.sessionId],
    );
    await db.query(
      "INSERT INTO source_files(revision_id,workspace_id,file_type,file_name,size_bytes,sha256,content,compare_status,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL)",
      [
        revisionId,
        ctx.workspaceId,
        format,
        input.fileName.slice(0, 255),
        input.bytes.length,
        createHash("sha256").update(input.bytes).digest("hex"),
        Buffer.from(input.bytes),
      ],
    );
    await db.query(
      "INSERT INTO document_jobs(id,workspace_id,revision_id,session_id) VALUES($1,$2,$3,$4)",
      [newId(), ctx.workspaceId, revisionId, ctx.sessionId],
    );
    if (old) await syncManual(db, id, revision, revisionId);
    return fileRevisionInTransaction(db, ctx, id);
  });
}
export async function documentDetails(ctx: SessionContext, id: string, revision: number) {
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const view = await sourceInTransaction(db, ctx, id, revision);
    if (!view.extraction) throw new AppError("not_found", 404, "문서 자료를 찾을 수 없습니다.");
    const row = (
      await db.query<{
        snapshot: DocumentSnapshot | null;
        comparison: DocumentComparison;
        status: string;
      }>("SELECT snapshot,comparison,status FROM document_results WHERE revision_id=$1", [
        view.revisionId,
      ])
    ).rows[0];
    let ocrReview: ReturnType<typeof reviewOcrDocuments> = null;
    if (
      view.fileType === "pdf" &&
      view.revision > 1 &&
      row?.status === "limited" &&
      row.snapshot?.extractionMode === "ocr"
    ) {
      const previous = (
        await db.query<{ snapshot: DocumentSnapshot | null }>(
          "SELECT d.snapshot FROM document_results d JOIN source_revisions r ON r.id=d.revision_id WHERE r.source_id=$1 AND r.revision=$2 AND r.workspace_id=$3 AND d.status='limited'",
          [id, view.revision - 1, ctx.workspaceId],
        )
      ).rows[0]?.snapshot;
      if (previous) ocrReview = reviewOcrDocuments(previous, row.snapshot);
    }
    return {
      snapshot: row?.snapshot ?? null,
      comparison: row?.comparison ?? { status: "limit_exceeded", changes: [] },
      ocrReview,
    };
  });
}
export async function retryDocument(
  ctx: SessionContext,
  id: string,
  revision: number,
  expectedRevision: number,
) {
  const file = await transaction(async (db) => {
    await assertSession(db, ctx, true);
    const view = await sourceInTransaction(db, ctx, id, revision);
    if (!view.extraction || ["queued", "processing"].includes(view.extraction.status))
      throw new AppError("conflict", 409, "처리 중인 문서는 다시 분석할 수 없습니다.");
    const row = (
      await db.query<{ file_name: string; content: Buffer }>(
        "SELECT file_name,content FROM source_files WHERE revision_id=$1",
        [view.revisionId],
      )
    ).rows[0];
    if (!row) throw new AppError("not_found", 404, "자료를 찾을 수 없습니다.");
    return row;
  });
  return registerDocument(
    ctx,
    { fileName: file.file_name, bytes: file.content, expectedRevision },
    id,
  );
}
