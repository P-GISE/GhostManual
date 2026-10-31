import { z } from "zod";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { type SourceInput, SourceInputSchema } from "./schemas.ts";
import { assertSession } from "./session.ts";
import { newId, RevisionIdSchema, type SessionContext, SourceIdSchema } from "./types.ts";

const SourceViewSchema = z.object({
  id: SourceIdSchema,
  revisionId: RevisionIdSchema,
  revision: z.number().int(),
  title: z.string(),
  text: z.string(),
  createdAt: z.date(),
  kind: z.enum(["text", "file"]),
  fileType: z.literal("xlsx").nullable(),
  uploadedByName: z.string().nullable(),
  uploadedByDepartment: z.string().nullable(),
});
export type SourceView = z.infer<typeof SourceViewSchema>;
export const fileReadonly = () =>
  new AppError("file_source_readonly", 422, "파일 자료는 새 버전을 올려서 바꿉니다.");
export async function assertSourceWrite(
  db: DbClient,
  ctx: SessionContext,
  input: SourceInput,
  creating: boolean,
) {
  // assertSession already locks this workspace row until the write commits.
  const usage = await db.query<Record<string, unknown>>(
    `SELECT (SELECT count(*) FROM sources WHERE workspace_id=$1) AS sources,
      count(*) AS revisions, COALESCE(sum(octet_length(title)+octet_length(text)),0) AS bytes,
      count(*) FILTER (WHERE created_at>now()-interval '1 minute') AS recent
      FROM source_revisions WHERE workspace_id=$1`,
    [ctx.workspaceId],
  );
  const count = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  const totals = z
    .object({ sources: count, revisions: count, bytes: count, recent: count })
    .parse(usage.rows[0]);
  const incoming = Buffer.byteLength(input.title, "utf8") + Buffer.byteLength(input.text, "utf8");
  if (
    (creating && totals.sources >= 50) ||
    totals.revisions >= 200 ||
    totals.bytes + incoming > 2 * 1024 * 1024
  )
    throw new AppError(
      "storage_quota",
      429,
      "작업 공간의 자료 보관 한도에 도달했습니다. 새 작업 공간을 이용하세요.",
    );
  if (totals.recent >= 20)
    throw new AppError(
      "source_write_limit",
      429,
      "자료 저장이 너무 빠릅니다. 잠시 후 다시 시도하세요.",
    );
}
// Copies the uploader's current name and department onto the revision; `param` holds the session id.
export const uploader = (param: string) =>
  `(SELECT u.name FROM sessions se JOIN users u ON u.id=se.user_id WHERE se.id=${param}),(SELECT u.department FROM sessions se JOIN users u ON u.id=se.user_id WHERE se.id=${param})`;
export function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((text, index) => ({ id: "p" + (index + 1), text: text.trim() }));
}
export async function sourceInTransaction(
  db: DbClient,
  ctx: SessionContext,
  id: string,
  revision?: number,
): Promise<SourceView> {
  const found = await db.query<Record<string, unknown>>(
    `SELECT s.id,r.id AS "revisionId",r.revision,r.title,r.text,r.created_at AS "createdAt",s.kind,s.file_type AS "fileType",r.uploaded_by_name AS "uploadedByName",r.uploaded_by_department AS "uploadedByDepartment" FROM sources s JOIN source_revisions r ON r.source_id=s.id AND r.revision=COALESCE($3,s.revision) WHERE s.id=$1 AND s.workspace_id=$2 AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM manuals m WHERE m.id=$4 AND m.source_id=s.id AND m.published_version IS NOT NULL AND m.needs_review=false AND EXISTS(SELECT 1 FROM manual_versions mv WHERE mv.manual_id=m.id AND mv.version=m.published_version AND mv.source_revision_id=r.id)))`,
    [id, ctx.workspaceId, revision ?? null, ctx.manualId],
  );
  if (!found.rows[0]) throw new AppError("not_found", 404, "자료를 찾을 수 없습니다.");
  return SourceViewSchema.parse(found.rows[0]);
}
export async function createSource(ctx: SessionContext, input: SourceInput): Promise<SourceView> {
  const parsed = SourceInputSchema.parse(input);
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    await assertSourceWrite(db, ctx, parsed, true);
    const id = newId();
    await db.query("INSERT INTO sources(id,workspace_id,revision) VALUES($1,$2,1)", [
      id,
      ctx.workspaceId,
    ]);
    await db.query(
      `INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text,uploaded_by_name,uploaded_by_department) SELECT $1,$2,$3,1,$4,$5,${uploader("$6")}`,
      [newId(), ctx.workspaceId, id, parsed.title, parsed.text, ctx.sessionId],
    );
    return sourceInTransaction(db, ctx, id);
  });
}
export async function getSource(ctx: SessionContext, id: string, revision?: number) {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    return sourceInTransaction(db, ctx, id, revision);
  });
}
export async function updateSource(
  ctx: SessionContext,
  id: string,
  input: SourceInput,
  expectedRevision: number,
) {
  const parsed = SourceInputSchema.parse(input);
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const old = await sourceInTransaction(db, ctx, id);
    if (old.kind === "file") throw fileReadonly();
    if (old.revision !== expectedRevision)
      throw new AppError("conflict", 409, "자료가 변경됐습니다. 새 버전을 확인하세요.");
    await assertSourceWrite(db, ctx, parsed, false);
    await db.query("UPDATE sources SET revision=revision+1 WHERE id=$1", [id]);
    await db.query(
      `INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text,uploaded_by_name,uploaded_by_department) SELECT $1,$2,$3,$4,$5,$6,${uploader("$7")}`,
      [newId(), ctx.workspaceId, id, old.revision + 1, parsed.title, parsed.text, ctx.sessionId],
    );
    await db.query("UPDATE manuals SET needs_review=true WHERE source_id=$1", [id]);
    return sourceInTransaction(db, ctx, id);
  });
}
export async function listSources(ctx: SessionContext) {
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const rows = await db.query<Record<string, unknown>>(
      "SELECT id FROM sources WHERE workspace_id=$1 ORDER BY created_at DESC",
      [ctx.workspaceId],
    );
    return Promise.all(
      rows.rows.map((row) => sourceInTransaction(db, ctx, z.uuid().parse(row["id"]))),
    );
  });
}
