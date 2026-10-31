import { z } from "zod";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { FileHistorySchema, fileHistory } from "./file-sources.ts";
import { type ManualDraft, ManualDraftSchema } from "./schemas.ts";
import { assertSession } from "./session.ts";
import { paragraphs } from "./sources.ts";
import {
  ManualIdSchema,
  newId,
  RevisionIdSchema,
  type SessionContext,
  SourceIdSchema,
} from "./types.ts";

export const ProvenanceSchema = z.enum(["ai", "human", "example"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;
export const ManualVersionViewSchema = z.object({
  id: z.uuid(),
  manualId: ManualIdSchema,
  version: z.number().int().positive(),
  sourceRevisionId: RevisionIdSchema,
  content: ManualDraftSchema,
  provenance: ProvenanceSchema,
  acknowledgedUnknowns: z.array(z.string()),
  history: FileHistorySchema.nullable(),
  createdAt: z.date(),
});
export type ManualVersionView = z.infer<typeof ManualVersionViewSchema>;
export const ManualViewSchema = z.object({
  id: ManualIdSchema,
  sourceId: SourceIdSchema,
  sourceRevisionId: RevisionIdSchema,
  draft: ManualDraftSchema,
  draftRevision: z.number().int().positive(),
  publishedVersion: z.number().int().positive().nullable(),
  published: ManualVersionViewSchema.nullable(),
  needsReview: z.boolean(),
  provenance: ProvenanceSchema,
  createdAt: z.date(),
});
export type ManualView = z.infer<typeof ManualViewSchema>;
const conflict = () =>
  new AppError("conflict", 409, "자료 또는 초안이 변경됐습니다. 새 버전을 확인하세요.");
const invalid = () =>
  new AppError("invalid_reference", 422, "원문 인용과 연결된 매뉴얼 항목을 확인하세요.");
function validateReferences(draft: ManualDraft, text: string) {
  const source = paragraphs(text);
  for (const ref of draft.references) {
    const [field, index, ...rest] = ref.field.split(".");
    const value = field ? Reflect.get(draft, field) : undefined;
    const knownField =
      Object.keys(ManualDraftSchema.shape).includes(field ?? "") &&
      field !== "references" &&
      field !== "unknowns";
    const target =
      index === undefined
        ? value
        : Array.isArray(value) && /^\d+$/.test(index)
          ? value[Number(index)]
          : undefined;
    if (
      !knownField ||
      rest.length ||
      typeof target !== "string" ||
      !source.find((p) => p.id === ref.paragraphId)?.text.includes(ref.quote)
    )
      throw invalid();
  }
}
async function versionInTransaction(
  db: DbClient,
  workspaceId: string,
  id: string,
  version: number,
) {
  const row = await db.query<Record<string, unknown>>(
    `SELECT id,manual_id AS "manualId",version,source_revision_id AS "sourceRevisionId",content,provenance,acknowledged_unknowns AS "acknowledgedUnknowns",history,created_at AS "createdAt" FROM manual_versions WHERE manual_id=$1 AND workspace_id=$2 AND version=$3`,
    [id, workspaceId, version],
  );
  return ManualVersionViewSchema.parse(row.rows[0]);
}
export async function manualInTransaction(
  db: DbClient,
  ctx: SessionContext,
  id: string,
): Promise<ManualView> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id,source_id AS "sourceId",source_revision_id AS "sourceRevisionId",draft,draft_revision AS "draftRevision",published_version AS "publishedVersion",needs_review AS "needsReview",provenance,created_at AS "createdAt" FROM manuals WHERE id=$1 AND workspace_id=$2 AND ($3::uuid IS NULL OR (id=$3 AND published_version IS NOT NULL))`,
    [id, ctx.workspaceId, ctx.manualId],
  );
  const row = rows.rows[0];
  if (!row) throw new AppError("not_found", 404, "매뉴얼을 찾을 수 없습니다.");
  const current = ManualViewSchema.omit({ published: true }).parse(row);
  const published =
    current.publishedVersion === null
      ? null
      : await versionInTransaction(db, ctx.workspaceId, id, current.publishedVersion);
  if (ctx.role === "reader" && published)
    return ManualViewSchema.parse({
      ...current,
      sourceRevisionId: published.sourceRevisionId,
      draft: published.content,
      draftRevision: published.version,
      provenance: published.provenance,
      published,
    });
  return { ...current, published };
}
export async function saveDraft(
  ctx: SessionContext,
  sourceRevisionId: string,
  draft: ManualDraft,
  expectedDraftRevision?: number,
  provenance: Provenance = "human",
): Promise<ManualView> {
  const parsed = ManualDraftSchema.parse(draft);
  const origin = ProvenanceSchema.parse(provenance);
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const sourceRows = await db.query<Record<string, unknown>>(
      `SELECT r.source_id AS "sourceId",r.text,r.revision,s.revision AS current FROM source_revisions r JOIN sources s ON s.id=r.source_id WHERE r.id=$1 AND r.workspace_id=$2`,
      [sourceRevisionId, ctx.workspaceId],
    );
    const raw = sourceRows.rows[0];
    if (!raw) throw new AppError("not_found", 404, "자료를 찾을 수 없습니다.");
    const source = z
      .object({
        sourceId: SourceIdSchema,
        text: z.string(),
        revision: z.number(),
        current: z.number(),
      })
      .parse(raw);
    if (source.revision !== source.current) throw conflict();
    validateReferences(parsed, source.text);
    const found = await db.query<Record<string, unknown>>(
      "SELECT id,draft_revision FROM manuals WHERE source_id=$1 AND workspace_id=$2 FOR UPDATE",
      [source.sourceId, ctx.workspaceId],
    );
    const old = found.rows[0];
    let id: string;
    if (old) {
      const existing = z.object({ id: ManualIdSchema, draft_revision: z.number() }).parse(old);
      if (expectedDraftRevision !== existing.draft_revision) throw conflict();
      id = existing.id;
      await db.query(
        "UPDATE manuals SET draft=$1,draft_revision=draft_revision+1,source_revision_id=$2,provenance=$3 WHERE id=$4",
        [parsed, sourceRevisionId, origin, id],
      );
    } else {
      if (expectedDraftRevision !== undefined) throw conflict();
      id = newId();
      await db.query(
        "INSERT INTO manuals(id,workspace_id,source_id,source_revision_id,draft,provenance) VALUES($1,$2,$3,$4,$5,$6)",
        [id, ctx.workspaceId, source.sourceId, sourceRevisionId, parsed, origin],
      );
    }
    return manualInTransaction(db, ctx, id);
  });
}
export async function publishManual(
  ctx: SessionContext,
  id: string,
  expectedRevision: number,
  acknowledgedUnknowns: readonly string[],
): Promise<ManualVersionView> {
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const current = await manualInTransaction(db, ctx, id);
    if (current.draftRevision !== expectedRevision) throw conflict();
    const source = await db.query<Record<string, unknown>>(
      `SELECT r.text,r.revision,s.revision AS current,s.id AS "sourceId" FROM source_revisions r JOIN sources s ON s.id=r.source_id WHERE r.id=$1 AND r.workspace_id=$2`,
      [current.sourceRevisionId, ctx.workspaceId],
    );
    const row = z
      .object({ text: z.string(), revision: z.number(), current: z.number(), sourceId: z.uuid() })
      .parse(source.rows[0]);
    if (row.revision !== row.current) throw conflict();
    const draft = current.draft;
    validateReferences(draft, row.text);
    const acknowledgements = z.array(z.string()).parse(acknowledgedUnknowns);
    if (
      !draft.purpose ||
      !draft.steps.length ||
      !draft.completion ||
      draft.unknowns.some((item) => !acknowledgements.includes(item)) ||
      acknowledgements.some((item) => !draft.unknowns.includes(item))
    )
      throw new AppError(
        "review_required",
        422,
        "목적·절차·완료 조건 및 미확인 항목을 검수하세요.",
      );
    const version = (current.publishedVersion ?? 0) + 1;
    await db.query(
      "INSERT INTO manual_versions(id,workspace_id,manual_id,version,source_revision_id,content,provenance,acknowledged_unknowns,history) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        newId(),
        ctx.workspaceId,
        id,
        version,
        current.sourceRevisionId,
        draft,
        current.provenance,
        JSON.stringify(acknowledgements),
        await fileHistory(db, ctx, row.sourceId, row.revision),
      ],
    );
    await db.query("UPDATE manuals SET published_version=$1,needs_review=false WHERE id=$2", [
      version,
      id,
    ]);
    return versionInTransaction(db, ctx.workspaceId, id, version);
  });
}
export async function getManual(ctx: SessionContext, id: string) {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    return manualInTransaction(db, ctx, id);
  });
}
export async function listManuals(ctx: SessionContext) {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    const rows = await db.query<Record<string, unknown>>(
      "SELECT id FROM manuals WHERE workspace_id=$1 AND ($2::uuid IS NULL OR (id=$2 AND published_version IS NOT NULL)) ORDER BY created_at DESC",
      [ctx.workspaceId, ctx.manualId],
    );
    return Promise.all(
      rows.rows.map((row) => manualInTransaction(db, ctx, z.uuid().parse(row["id"]))),
    );
  });
}

export async function listManualVersions(ctx: SessionContext, id: string) {
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    await manualInTransaction(db, ctx, id);
    const rows = await db.query<Record<string, unknown>>(
      'SELECT id,manual_id AS "manualId",version,source_revision_id AS "sourceRevisionId",content,provenance,acknowledged_unknowns AS "acknowledgedUnknowns",history,created_at AS "createdAt" FROM manual_versions WHERE manual_id=$1 AND workspace_id=$2 ORDER BY version DESC',
      [id, ctx.workspaceId],
    );
    return rows.rows.map((row) => ManualVersionViewSchema.parse(row));
  });
}
