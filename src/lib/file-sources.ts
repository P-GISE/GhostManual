import { createHash } from "node:crypto";
import { z } from "zod";
import { FILE_QUOTA_BYTES } from "./accounts.ts";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertSession } from "./session.ts";
import { assertSourceWrite, type SourceView, sourceInTransaction, uploader } from "./sources.ts";
import { newId, type SessionContext } from "./types.ts";
import { buildQuestions, type ReadResult, type RuleQuestion, readXlsx } from "./xlsx/index.ts";

export const MAX_FILE_BYTES = 5242880;
const QuestionRow = z.object({
  id: z.uuid(),
  kind: z.enum(["purpose", "origin", "change", "other"]),
  question: z.string(),
  answer: z.string().nullable(),
  skipped: z.boolean(),
  source: z.enum(["rule", "ai"]),
  groupPositions: z.array(z.number().int()),
});
const ChangeRow = z.object({
  position: z.number().int(),
  kind: z.string(),
  sheet: z.string().nullable(),
  range: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()),
});
export type QuestionView = z.infer<typeof QuestionRow>;
export type ChangeView = z.infer<typeof ChangeRow>;
export type CompareStatus = "first" | "compared" | "no_changes" | "limit_exceeded";
export type FileRevisionView = Omit<SourceView, "kind" | "fileType" | "text"> & {
  kind: "file";
  fileType: "xlsx";
  file: { name: string; sizeBytes: number };
  compareStatus: CompareStatus;
  aiSummary: string | null;
  changes: ChangeView[];
  questions: QuestionView[];
  usage: { bytes: number; limitBytes: number };
};

export function assertFileQuota(usedBytes: number, incomingBytes: number): void {
  if (usedBytes + incomingBytes > FILE_QUOTA_BYTES)
    throw new AppError(
      "storage_quota",
      429,
      "저장 공간(100 MB)이 가득 찼습니다. 오래된 자료를 지운 뒤 다시 올리세요.",
    );
}
export function readUpload(bytes: Uint8Array): ReadResult {
  if (bytes.length > MAX_FILE_BYTES)
    throw new AppError("file_too_large", 413, "파일은 5 MB까지 올릴 수 있습니다.");
  return readXlsx(bytes);
}
// Search/evidence text for a file revision: sheet names and header rows only, never other cells.
export function fileText(title: string, result: ReadResult): string {
  if (result.status !== "compared") return `${title}\n(내용 비교 한도를 넘는 엑셀 파일)`;
  const lines = result.snapshot.sheets.map((sheet) => {
    const header = Object.entries(sheet.cells)
      .filter(([address]) => /^[A-Z]+1$/.test(address))
      .map(([, cell]) => String(cell.v ?? ""))
      .filter(Boolean)
      .join(", ");
    return `시트 ${sheet.name} (${sheet.rows}행 × ${sheet.cols}열)${header ? `: ${header}` : ""}`;
  });
  return `${title}\n${lines.join("\n")}`.slice(0, 20000);
}
export async function usedFileBytes(db: DbClient, workspaceId: string): Promise<number> {
  const result = await db.query<{ bytes: string }>(
    "SELECT COALESCE(sum(size_bytes),0) AS bytes FROM source_files WHERE workspace_id=$1",
    [workspaceId],
  );
  return Number(result.rows[0]?.bytes ?? 0);
}
export async function insertFileRevision(
  db: DbClient,
  ctx: SessionContext,
  input: {
    sourceId: string;
    revision: number;
    title: string;
    fileName: string;
    bytes: Uint8Array;
    result: ReadResult;
    aiSummary: string | null;
    changes: readonly {
      kind: string;
      sheet: string | null;
      range: string | null;
      summary: object;
    }[];
    questions: readonly (Pick<RuleQuestion, "kind" | "question"> & {
      groupIndexes: readonly number[];
      source: "rule" | "ai";
    })[];
  },
): Promise<string> {
  const revisionId = newId();
  await db.query(
    `INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text,uploaded_by_name,uploaded_by_department) SELECT $1,$2,$3,$4,$5,$6,${uploader("$7")}`,
    [
      revisionId,
      ctx.workspaceId,
      input.sourceId,
      input.revision,
      input.title,
      fileText(input.title, input.result),
      ctx.sessionId,
    ],
  );
  const snapshot = input.result.status === "compared" ? input.result.snapshot : null;
  await db.query(
    "INSERT INTO source_files(revision_id,workspace_id,file_name,size_bytes,sha256,content,compare_status,snapshot,ai_summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      revisionId,
      ctx.workspaceId,
      input.fileName.slice(0, 255),
      input.bytes.length,
      createHash("sha256").update(input.bytes).digest("hex"),
      Buffer.from(input.bytes),
      input.result.status,
      snapshot,
      input.aiSummary,
    ],
  );
  for (const [position, change] of input.changes.entries())
    await db.query(
      "INSERT INTO change_groups(id,workspace_id,revision_id,position,kind,sheet,range,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        newId(),
        ctx.workspaceId,
        revisionId,
        position,
        change.kind,
        change.sheet,
        change.range,
        change.summary,
      ],
    );
  for (const [position, question] of input.questions.entries())
    await db.query(
      "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,group_positions,question,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        newId(),
        ctx.workspaceId,
        revisionId,
        position,
        question.kind,
        question.groupIndexes,
        question.question,
        question.source,
      ],
    );
  return revisionId;
}
export async function fileRevisionInTransaction(
  db: DbClient,
  ctx: SessionContext,
  id: string,
  revision?: number,
): Promise<FileRevisionView> {
  const { text: _text, kind, fileType, ...base } = await sourceInTransaction(db, ctx, id, revision);
  if (kind !== "file" || fileType !== "xlsx")
    throw new AppError("not_found", 404, "자료를 찾을 수 없습니다.");
  const file = await db.query<Record<string, unknown>>(
    'SELECT file_name AS name,size_bytes AS "sizeBytes",compare_status AS status,ai_summary AS "aiSummary" FROM source_files WHERE revision_id=$1',
    [base.revisionId],
  );
  const row = z
    .object({
      name: z.string(),
      sizeBytes: z.number(),
      status: z.enum(["compared", "limit_exceeded"]),
      aiSummary: z.string().nullable(),
    })
    .parse(file.rows[0]);
  const changes = z
    .array(ChangeRow)
    .parse(
      (
        await db.query(
          "SELECT position,kind,sheet,range,summary FROM change_groups WHERE revision_id=$1 ORDER BY position",
          [base.revisionId],
        )
      ).rows,
    );
  const questions = z
    .array(QuestionRow)
    .parse(
      (
        await db.query(
          'SELECT id,kind,question,answer,skipped,source,group_positions AS "groupPositions" FROM revision_questions WHERE revision_id=$1 ORDER BY position',
          [base.revisionId],
        )
      ).rows,
    );
  // A later revision with questions but no changes could not be compared (one side was over the limit).
  const compareStatus: CompareStatus =
    base.revision === 1
      ? "first"
      : row.status === "limit_exceeded" || (!changes.length && questions.length)
        ? "limit_exceeded"
        : changes.length
          ? "compared"
          : "no_changes";
  return {
    ...base,
    kind,
    fileType,
    file: { name: row.name, sizeBytes: row.sizeBytes },
    compareStatus,
    aiSummary: row.aiSummary,
    changes,
    questions,
    usage: { bytes: await usedFileBytes(db, ctx.workspaceId), limitBytes: FILE_QUOTA_BYTES },
  };
}
export async function createFileSource(
  ctx: SessionContext,
  input: { title: string; fileName: string; bytes: Uint8Array },
): Promise<FileRevisionView> {
  const title = z.string().trim().min(1).max(120).safeParse(input.title);
  if (!title.success) throw new AppError("invalid_input", 422, "제목은 120자까지 입력하세요.");
  const result = readUpload(input.bytes);
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    await assertSourceWrite(
      db,
      ctx,
      { title: title.data, text: fileText(title.data, result) },
      true,
    );
    assertFileQuota(await usedFileBytes(db, ctx.workspaceId), input.bytes.length);
    const id = newId();
    await db.query(
      "INSERT INTO sources(id,workspace_id,revision,kind,file_type) VALUES($1,$2,1,'file','xlsx')",
      [id, ctx.workspaceId],
    );
    await insertFileRevision(db, ctx, {
      sourceId: id,
      revision: 1,
      title: title.data,
      fileName: input.fileName,
      bytes: input.bytes,
      result,
      aiSummary: null,
      changes: [],
      questions: buildQuestions([], true).map((q) => ({ ...q, source: "rule" as const })),
    });
    return fileRevisionInTransaction(db, ctx, id);
  });
}
