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
});
export type SourceView = z.infer<typeof SourceViewSchema>;
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
    `SELECT s.id,r.id AS "revisionId",r.revision,r.title,r.text,r.created_at AS "createdAt" FROM sources s JOIN source_revisions r ON r.source_id=s.id AND r.revision=COALESCE($3,s.revision) WHERE s.id=$1 AND s.workspace_id=$2 AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM manuals m WHERE m.id=$4 AND m.source_id=s.id AND m.published_version IS NOT NULL AND m.needs_review=false AND EXISTS(SELECT 1 FROM manual_versions mv WHERE mv.manual_id=m.id AND mv.version=m.published_version AND mv.source_revision_id=r.id)))`,
    [id, ctx.workspaceId, revision ?? null, ctx.manualId],
  );
  if (!found.rows[0]) throw new AppError("not_found", 404, "자료를 찾을 수 없습니다.");
  return SourceViewSchema.parse(found.rows[0]);
}
export async function createSource(ctx: SessionContext, input: SourceInput): Promise<SourceView> {
  const parsed = SourceInputSchema.parse(input);
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const id = newId();
    await db.query("INSERT INTO sources(id,workspace_id,revision) VALUES($1,$2,1)", [
      id,
      ctx.workspaceId,
    ]);
    await db.query(
      "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,1,$4,$5)",
      [newId(), ctx.workspaceId, id, parsed.title, parsed.text],
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
    if (old.revision !== expectedRevision)
      throw new AppError("conflict", 409, "자료가 변경됐습니다. 새 버전을 확인하세요.");
    await db.query("UPDATE sources SET revision=revision+1 WHERE id=$1", [id]);
    await db.query(
      "INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text) VALUES($1,$2,$3,$4,$5,$6)",
      [newId(), ctx.workspaceId, id, old.revision + 1, parsed.title, parsed.text],
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
