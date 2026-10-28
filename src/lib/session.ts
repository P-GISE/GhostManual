import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { type DbClient, pool, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import {
  ManualIdSchema,
  newId,
  type SessionContext,
  SessionIdSchema,
  WorkspaceIdSchema,
} from "./types.ts";
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function freshToken() {
  return randomBytes(32).toString("base64url");
}
export async function createWorkspace(mode: "blank" | "example" = "blank") {
  const token = freshToken();
  const workspaceId = WorkspaceIdSchema.parse(newId()),
    sessionId = SessionIdSchema.parse(newId());
  const expiresAt = await transaction(async (db) => {
    const w = await db.query<Record<string, unknown>>(
      "INSERT INTO workspaces(id,mode) VALUES($1,$2) RETURNING expires_at",
      [workspaceId, mode],
    );
    const expiry = z.date().parse(w.rows[0]?.["expires_at"]);
    await db.query(
      "INSERT INTO sessions(id,workspace_id,token_hash,role,expires_at) VALUES($1,$2,$3,'owner',$4)",
      [sessionId, workspaceId, tokenHash(token), expiry],
    );
    return expiry;
  });
  return { token, workspaceId, sessionId, expiresAt };
}
const rowSchema = z.object({
  workspace_id: WorkspaceIdSchema,
  id: SessionIdSchema,
  role: z.enum(["owner", "reader"]),
  expires_at: z.date(),
  share_id: z.uuid().nullable(),
  manual_id: ManualIdSchema.nullable(),
});
export async function requireSession(token: string): Promise<SessionContext> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError("unauthorized", 401, "로그인이 필요합니다.");
  const result = await pool.query<Record<string, unknown>>(
    `SELECT s.*,sh.manual_id FROM sessions s JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN shares sh ON sh.id=s.share_id LEFT JOIN manuals m ON m.id=sh.manual_id WHERE s.token_hash=$1 AND s.expires_at>now() AND w.expires_at>now() AND (s.role='owner' OR (sh.revoked_at IS NULL AND sh.expires_at>now() AND m.published_version IS NOT NULL AND m.needs_review=false))`,
    [tokenHash(token)],
  );
  const found = result.rows[0];
  if (!found) throw new AppError("unauthorized", 401, "로그인이 만료됐거나 공유가 취소됐습니다.");
  const row = rowSchema.parse(found);
  const base = { workspaceId: row.workspace_id, sessionId: row.id, expiresAt: row.expires_at };
  if (row.role === "owner") return { ...base, role: "owner", shareId: null, manualId: null };
  if (!row.share_id || !row.manual_id)
    throw new AppError("unauthorized", 401, "공유를 확인하세요.");
  return { ...base, role: "reader", shareId: row.share_id, manualId: row.manual_id };
}
export async function assertSession(db: DbClient, ctx: SessionContext, ownerOnly = false) {
  if (ownerOnly && ctx.role !== "owner")
    throw new AppError("forbidden", 403, "소유자만 수정할 수 있습니다.");
  const w = await db.query(
    "SELECT id FROM workspaces WHERE id=$1 AND expires_at>now() FOR UPDATE",
    [ctx.workspaceId],
  );
  if (!w.rowCount) throw new AppError("unauthorized", 401, "작업 공간이 만료됐습니다.");
  const s = await db.query(
    `SELECT s.id FROM sessions s LEFT JOIN shares sh ON sh.id=s.share_id LEFT JOIN manuals m ON m.id=sh.manual_id WHERE s.id=$1 AND s.workspace_id=$2 AND s.expires_at>now() AND s.role=$3 AND (s.role='owner' OR (sh.id=$4 AND sh.revoked_at IS NULL AND sh.expires_at>now() AND m.published_version IS NOT NULL AND m.needs_review=false AND sh.manual_id=$5))`,
    [ctx.sessionId, ctx.workspaceId, ctx.role, ctx.shareId, ctx.manualId],
  );
  if (!s.rowCount) throw new AppError("unauthorized", 401, "세션 또는 공유가 만료됐습니다.");
}
