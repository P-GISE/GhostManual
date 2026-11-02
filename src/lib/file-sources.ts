import { createHash } from "node:crypto";
import { z } from "zod";
import { FILE_QUOTA_BYTES } from "./accounts.ts";
import { generateFileManual } from "./ai.ts";
import { type CellChange, diffCells } from "./cell-diff.ts";
import { changePrompt, changeQuestions, textHeaders } from "./change-ai.ts";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { fileStem } from "./file-stem.ts";
import { type ManualDraft, ManualDraftSchema } from "./schemas.ts";
import { assertSession } from "./session.ts";
import { assertSourceWrite, type SourceView, sourceInTransaction, uploader } from "./sources.ts";
import { newId, type SessionContext } from "./types.ts";
import {
  buildQuestions,
  compareSnapshots,
  type ReadResult,
  type RuleQuestion,
  readXlsx,
  type Snapshot,
} from "./xlsx/index.ts";

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
    const header = textHeaders(sheet).filter(Boolean).join(", ");
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
  let questions = z
    .array(QuestionRow)
    .parse(
      (
        await db.query(
          'SELECT id,kind,question,answer,skipped,source,group_positions AS "groupPositions" FROM revision_questions WHERE revision_id=$1 ORDER BY position',
          [base.revisionId],
        )
      ).rows,
    );
  if (ctx.role === "reader") {
    const published = await db.query<{ history: unknown }>(
      "SELECT mv.history FROM manuals m JOIN manual_versions mv ON mv.manual_id=m.id AND mv.version=m.published_version WHERE m.id=$1 AND m.workspace_id=$2 AND mv.source_revision_id=$3 AND m.needs_review=false",
      [ctx.manualId, ctx.workspaceId, base.revisionId],
    );
    const history = FileHistorySchema.nullable().parse(published.rows[0]?.history ?? null);
    const frozen = history?.revisions.find((item) => item.revision === base.revision);
    // Question identity is immutable; only published answers may cross the Reader boundary.
    questions = (frozen?.questions ?? []).map((snapshot, index) => {
      const identity = questions[index];
      if (!identity || identity.question !== snapshot.question)
        throw new AppError("not_found", 404, "게시된 질문을 찾을 수 없습니다.");
      return { ...identity, ...snapshot };
    });
  }
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
type RevisionQuestions = { revision: number; questions: string[]; unanswered: string[] };
const questionItem = (revision: number, question: string) =>
  `[v${revision} 확인 필요] ${question}`.slice(0, 500);
const summaryItem = (revision: number, count: number) =>
  `[v${revision} 확인 필요] 답하지 않은 변경 질문 ${count}건`;

export function syncUnknowns(
  unknowns: readonly string[],
  revisions: readonly RevisionQuestions[],
): string[] {
  const generated = new Set<string>();
  for (const { revision, questions } of revisions) {
    for (const question of questions) generated.add(questionItem(revision, question));
    for (let count = 2; count <= questions.length; count++)
      generated.add(summaryItem(revision, count));
  }
  const result = unknowns.filter((item) => !generated.has(item));
  for (const { revision, unanswered } of revisions) {
    const room = 30 - result.length;
    const items = unanswered.map((question) => questionItem(revision, question));
    if (items.length <= room) {
      result.push(...items);
    } else if (room > 0) {
      result.push(...items.slice(0, room - 1), summaryItem(revision, items.length - room + 1));
    } else {
      throw new AppError(
        "unknowns_limit",
        422,
        "확인 필요 항목이 30개입니다. 기존 항목을 정리하거나 질문에 답한 뒤 다시 시도하세요.",
      );
    }
  }
  return result;
}
export async function reconcileFileUnknowns(
  db: DbClient,
  sourceId: string,
  upToRevision: number,
  unknowns: readonly string[],
  fromRevision = 1,
): Promise<string[]> {
  const revisions = await db.query<RevisionQuestions>(
    `SELECT r.revision,array_agg(q.question ORDER BY q.position) AS questions,
       COALESCE(array_agg(q.question ORDER BY q.position) FILTER (WHERE q.answer IS NULL),
         ARRAY[]::text[]) AS unanswered
     FROM source_revisions r JOIN revision_questions q ON q.revision_id=r.id
     WHERE r.source_id=$1 AND r.revision BETWEEN $3 AND $2 GROUP BY r.revision ORDER BY r.revision`,
    [sourceId, upToRevision, fromRevision],
  );
  return syncUnknowns(unknowns, revisions.rows);
}
export async function syncManual(
  db: DbClient,
  sourceId: string,
  revision: number,
  revisionId: string | null,
): Promise<void> {
  const manual = await db.query<{ id: string; draft: unknown }>(
    "SELECT id,draft FROM manuals WHERE source_id=$1 FOR UPDATE",
    [sourceId],
  );
  const row = manual.rows[0];
  if (!row) return;
  const draft = ManualDraftSchema.parse(row.draft);
  const unknowns = await reconcileFileUnknowns(db, sourceId, revision, draft.unknowns, revision);
  await db.query(
    `UPDATE manuals SET draft=$1,draft_revision=draft_revision+1${revisionId ? ",needs_review=true,source_revision_id=$3" : ""} WHERE id=$2`,
    revisionId ? [{ ...draft, unknowns }, row.id, revisionId] : [{ ...draft, unknowns }, row.id],
  );
}
export async function addFileRevision(
  ctx: SessionContext,
  id: string,
  input: { fileName: string; bytes: Uint8Array; expectedRevision: number },
): Promise<FileRevisionView> {
  const result = readUpload(input.bytes);
  const conflict = () =>
    new AppError("conflict", 409, "다른 곳에서 새 버전이 올라왔습니다. 새로고침 후 다시 올리세요.");
  const previous = await transaction(async (db) => {
    await assertSession(db, ctx, true);
    const source = await sourceInTransaction(db, ctx, id);
    if (source.kind !== "file")
      throw new AppError(
        "file_type_mismatch",
        422,
        "같은 자료에는 같은 형식의 파일만 올릴 수 있습니다. 새 자료로 올리세요.",
      );
    if (source.revision !== input.expectedRevision) throw conflict();
    const file = await db.query<{ snapshot: Snapshot | null }>(
      "SELECT snapshot FROM source_files WHERE revision_id=$1",
      [source.revisionId],
    );
    return {
      title: source.title,
      revision: source.revision,
      snapshot: file.rows[0]?.snapshot ?? null,
    };
  });
  const groups =
    previous.snapshot && result.status === "compared"
      ? compareSnapshots(previous.snapshot, result.snapshot)
      : null;
  // The AI call runs outside any transaction; the write below re-checks the revision.
  const ai =
    groups?.length && result.status === "compared"
      ? await changeQuestions(ctx, previous.title, result.snapshot, groups)
      : null;
  const questions = ai
    ? ai.questions.map((q) => ({
        kind: "change" as const,
        groupIndexes: q.groupPositions,
        question: q.question,
        source: "ai" as const,
      }))
    : buildQuestions(groups, false).map((q) => ({ ...q, source: "rule" as const }));
  const revision = previous.revision + 1;
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const current = await sourceInTransaction(db, ctx, id);
    if (current.revision !== previous.revision) throw conflict();
    await assertSourceWrite(
      db,
      ctx,
      { title: previous.title, text: fileText(previous.title, result) },
      false,
    );
    assertFileQuota(await usedFileBytes(db, ctx.workspaceId), input.bytes.length);
    await db.query("UPDATE sources SET revision=$1 WHERE id=$2", [revision, id]);
    const revisionId = await insertFileRevision(db, ctx, {
      sourceId: id,
      revision,
      title: previous.title,
      fileName: input.fileName,
      bytes: input.bytes,
      result,
      aiSummary: ai?.summary ?? null,
      changes: groups ?? [],
      questions,
    });
    await syncManual(db, id, revision, revisionId);
    return fileRevisionInTransaction(db, ctx, id);
  });
}
export type RevisionSummary = {
  revision: number;
  revisionId: string;
  createdAt: Date;
  uploadedByName: string | null;
  uploadedByDepartment: string | null;
  file: { name: string; sizeBytes: number };
  compareStatus: CompareStatus;
  changeCount: number;
  questionCount: number;
  answeredCount: number;
};
export async function listFileRevisions(
  ctx: SessionContext,
  id: string,
): Promise<RevisionSummary[]> {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    // sourceInTransaction resolves a reader to the revision its shared manual was published from.
    const latest = await sourceInTransaction(db, ctx, id);
    const rows = await db.query<{ revision: number }>(
      "SELECT revision FROM source_revisions WHERE source_id=$1 AND workspace_id=$2 ORDER BY revision DESC",
      [id, ctx.workspaceId],
    );
    const list: RevisionSummary[] = [];
    for (const { revision } of rows.rows) {
      if (ctx.role === "reader" && revision !== latest.revision) continue;
      const view = await fileRevisionInTransaction(db, ctx, id, revision);
      list.push({
        revision: view.revision,
        revisionId: view.revisionId,
        createdAt: view.createdAt,
        uploadedByName: view.uploadedByName,
        uploadedByDepartment: view.uploadedByDepartment,
        file: view.file,
        compareStatus: view.compareStatus,
        changeCount: view.changes.length,
        questionCount: view.questions.length,
        answeredCount: view.questions.filter((q) => q.answer !== null).length,
      });
    }
    return list;
  });
}
export type SheetPreview = {
  sheet: string;
  hidden: boolean;
  rows: number;
  cols: number;
  cells: (string | number | boolean | null)[][];
};
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
export function preview(snapshot: Snapshot): SheetPreview[] {
  return snapshot.sheets.map((sheet) => ({
    sheet: sheet.name,
    hidden: sheet.hidden,
    rows: sheet.rows,
    cols: sheet.cols,
    cells: Array.from({ length: Math.min(sheet.rows, 20) }, (_, r) =>
      Array.from(
        { length: Math.min(sheet.cols, 12) },
        (_, c) => sheet.cells[`${columnName(c)}${r + 1}`]?.v ?? null,
      ),
    ),
  }));
}
export async function getFileRevision(ctx: SessionContext, id: string, revision: number) {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    const view = await fileRevisionInTransaction(db, ctx, id, revision);
    const file = await db.query<{ snapshot: Snapshot | null }>(
      "SELECT snapshot FROM source_files WHERE revision_id=$1",
      [view.revisionId],
    );
    const snapshot = file.rows[0]?.snapshot;
    return { ...view, preview: snapshot ? preview(snapshot) : [] };
  });
}
export async function fileContent(ctx: SessionContext, id: string, revision: number) {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    const view = await fileRevisionInTransaction(db, ctx, id, revision);
    const file = await db.query<{ content: Buffer }>(
      "SELECT content FROM source_files WHERE revision_id=$1",
      [view.revisionId],
    );
    const content = file.rows[0]?.content;
    if (!content) throw new AppError("not_found", 404, "자료를 찾을 수 없습니다.");
    return { fileName: view.file.name, bytes: new Uint8Array(content) };
  });
}
const AnswerSchema = z.union([
  z.strictObject({ answer: z.string().trim().min(1).max(2000) }),
  z.strictObject({ skipped: z.literal(true) }),
]);
export async function answerQuestion(
  ctx: SessionContext,
  id: string,
  revision: number,
  questionId: string,
  input: unknown,
): Promise<QuestionView> {
  const parsed = AnswerSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("invalid_input", 422, "답변은 1~2,000자로 입력하거나 건너뛰세요.");
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const view = await fileRevisionInTransaction(db, ctx, id, revision);
    const answer = "answer" in parsed.data ? parsed.data.answer : null;
    const updated = await db.query(
      `UPDATE revision_questions SET answer=$1,skipped=$2,answered_at=now() WHERE id=$3 AND revision_id=$4
        RETURNING id,kind,question,answer,skipped,source,group_positions AS "groupPositions"`,
      [answer, answer === null, questionId, view.revisionId],
    );
    if (!updated.rows[0]) throw new AppError("not_found", 404, "질문을 찾을 수 없습니다.");
    await syncManual(db, id, revision, null);
    return QuestionRow.parse(updated.rows[0]);
  });
}
export const FileHistorySchema = z.object({
  v: z.literal(1),
  revisions: z.array(
    z.object({
      revision: z.number().int(),
      createdAt: z.coerce.date(),
      uploadedByName: z.string().nullable(),
      uploadedByDepartment: z.string().nullable(),
      fileName: z.string(),
      compareStatus: z.enum(["first", "compared", "no_changes", "limit_exceeded"]),
      aiSummary: z.string().nullable(),
      changes: z.array(
        z.object({ kind: z.string(), sheet: z.string().nullable(), range: z.string().nullable() }),
      ),
      questions: z.array(
        z.object({ question: z.string(), answer: z.string().nullable(), skipped: z.boolean() }),
      ),
    }),
  ),
});
export type FileHistory = z.infer<typeof FileHistorySchema>;
// Snapshot of every file revision up to the published one, frozen into manual_versions.history.
export async function fileHistory(
  db: DbClient,
  ctx: SessionContext,
  sourceId: string,
  upToRevision: number,
): Promise<FileHistory | null> {
  const kind = await db.query<{ kind: string }>("SELECT kind FROM sources WHERE id=$1", [sourceId]);
  if (kind.rows[0]?.kind !== "file") return null;
  const revisions: FileHistory["revisions"] = [];
  for (let revision = 1; revision <= upToRevision; revision++) {
    const view = await fileRevisionInTransaction(db, ctx, sourceId, revision);
    revisions.push({
      revision,
      createdAt: view.createdAt,
      uploadedByName: view.uploadedByName,
      uploadedByDepartment: view.uploadedByDepartment,
      fileName: view.file.name,
      compareStatus: view.compareStatus,
      aiSummary: view.aiSummary,
      changes: view.changes.map(({ kind, sheet, range }) => ({ kind, sheet, range })),
      questions: view.questions.map(({ question, answer, skipped }) => ({
        question,
        answer,
        skipped,
      })),
    });
  }
  return { v: 1, revisions };
}
export type SimilarSource = {
  id: string;
  title: string;
  revision: number;
  fileName: string;
  sameAsLatest: boolean;
};
// Existing workbooks this upload is probably a new version of: same file stem, same title or same bytes.
export async function similarSources(
  ctx: SessionContext,
  input: { fileName: string; title: string; sha256: string },
): Promise<SimilarSource[]> {
  const stem = fileStem(input.fileName);
  const title = input.title.trim().toLowerCase();
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const rows = await db.query<{
      id: string;
      title: string;
      revision: number;
      file_name: string;
      sha256: string;
    }>(
      `SELECT s.id,r.title,s.revision,f.file_name,f.sha256 FROM sources s
        JOIN source_revisions r ON r.source_id=s.id AND r.revision=s.revision
        JOIN source_files f ON f.revision_id=r.id
        WHERE s.workspace_id=$1 AND s.kind='file' ORDER BY s.created_at DESC`,
      [ctx.workspaceId],
    );
    return rows.rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        revision: r.revision,
        fileName: r.file_name,
        sameAsLatest: r.sha256 === input.sha256,
        match:
          r.sha256 === input.sha256 ||
          fileStem(r.file_name) === stem ||
          (title !== "" && r.title.trim().toLowerCase() === title),
      }))
      .filter((r) => r.match)
      .sort((a, b) => Number(b.sameAsLatest) - Number(a.sameAsLatest))
      .slice(0, 5)
      .map(({ match: _match, ...r }) => r);
  });
}
// AI manual draft for a workbook: sheet structure and every version's changes, questions and answers.
// Non-formula text in the first row is included as potential headers.
export async function draftFromFile(
  ctx: SessionContext,
  sourceId: string,
  expectedRevision: number,
): Promise<ManualDraft> {
  const input = await transaction(async (db) => {
    await assertSession(db, ctx, true);
    const latest = await sourceInTransaction(db, ctx, sourceId);
    if (latest.revision !== expectedRevision)
      throw new AppError("conflict", 409, "자료가 변경됐습니다.");
    const file = await db.query<{ snapshot: Snapshot | null }>(
      "SELECT snapshot FROM source_files WHERE revision_id=$1",
      [latest.revisionId],
    );
    const snapshot = file.rows[0]?.snapshot;
    const history = await fileHistory(db, ctx, sourceId, latest.revision);
    return {
      title: latest.title,
      sheets: snapshot ? changePrompt(latest.title, snapshot, []).sheets : [],
      versions: (history?.revisions ?? []).map((r) => ({
        revision: r.revision,
        aiSummary: r.aiSummary,
        changes: r.changes,
        questions: r.questions.map((q) => ({ question: q.question, answer: q.answer })),
      })),
    };
  });
  return generateFileManual(input);
}
export type CellChanges = { compared: boolean; total: number; changes: CellChange[] };
// Cell-by-cell record of one version against the previous one, rebuilt from the stored immutable snapshots.
// A diff includes previous values, which are private even when the current workbook is shared.
export async function cellChanges(
  ctx: SessionContext,
  id: string,
  revision: number,
  limit = 500,
): Promise<CellChanges> {
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const view = await fileRevisionInTransaction(db, ctx, id, revision);
    if (view.revision === 1) return { compared: true, total: 0, changes: [] };
    const rows = await db.query<{ revision: number; snapshot: Snapshot | null }>(
      `SELECT r.revision,f.snapshot FROM source_revisions r JOIN source_files f ON f.revision_id=r.id
        WHERE r.source_id=$1 AND r.workspace_id=$2 AND r.revision IN ($3,$3-1)`,
      [id, ctx.workspaceId, view.revision],
    );
    const before = rows.rows.find((r) => r.revision === view.revision - 1)?.snapshot;
    const after = rows.rows.find((r) => r.revision === view.revision)?.snapshot;
    if (!before || !after) return { compared: false, total: 0, changes: [] };
    const all = diffCells(before, after);
    return { compared: true, total: all.length, changes: all.slice(0, limit) };
  });
}
