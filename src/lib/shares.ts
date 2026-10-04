import { z } from "zod";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertSession, freshToken, tokenHash } from "./session.ts";
import {
  ManualIdSchema,
  newId,
  type SessionContext,
  SessionIdSchema,
  WorkspaceIdSchema,
} from "./types.ts";

const shareRow = z.object({ id: z.uuid(), manualId: ManualIdSchema, expiresAt: z.date() });
export async function listShares(owner: SessionContext, manualId: string) {
  return transaction(async (db) => {
    await assertSession(db, owner, true);
    const result = await db.query<Record<string, unknown>>(
      'SELECT id,manual_id AS "manualId",expires_at AS "expiresAt" FROM shares WHERE workspace_id=$1 AND manual_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY expires_at,id',
      [owner.workspaceId, manualId],
    );
    return z.array(shareRow).parse(result.rows);
  });
}
export async function createShare(owner: SessionContext, manualId: string) {
  return transaction(async (db) => {
    await assertSession(db, owner, true);
    const manual = await db.query(
      "SELECT id FROM manuals WHERE id=$1 AND workspace_id=$2 AND published_version IS NOT NULL AND needs_review=false",
      [manualId, owner.workspaceId],
    );
    if (!manual.rowCount) throw new AppError("not_found", 404, "검수한 매뉴얼을 찾을 수 없습니다.");
    const token = freshToken();
    const result = await db.query<Record<string, unknown>>(
      `INSERT INTO shares(id,workspace_id,manual_id,token_hash,expires_at) SELECT $1,w.id,$2,$3,LEAST(w.expires_at,now()+interval '7 days') FROM workspaces w WHERE w.id=$4 RETURNING id,manual_id AS "manualId",expires_at AS "expiresAt"`,
      [newId(), manualId, tokenHash(token), owner.workspaceId],
    );
    return { ...shareRow.parse(result.rows[0]), token, url: `/share#${token}` };
  });
}
export async function exchangeShare(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError("unauthorized", 401, "공유가 만료되거나 취소됐습니다.");
  return transaction(async (db) => {
    const result = await db.query<Record<string, unknown>>(
      `SELECT sh.id,sh.workspace_id,sh.manual_id,LEAST(sh.expires_at,w.expires_at) AS expires_at FROM shares sh JOIN workspaces w ON w.id=sh.workspace_id JOIN manuals m ON m.id=sh.manual_id WHERE sh.token_hash=$1 AND sh.revoked_at IS NULL AND sh.expires_at>now() AND w.expires_at>now() AND m.published_version IS NOT NULL AND m.needs_review=false FOR UPDATE OF w`,
      [tokenHash(token)],
    );
    const row = result.rows[0];
    if (!row) throw new AppError("unauthorized", 401, "공유가 만료되거나 취소됐습니다.");
    const share = z
      .object({
        id: z.uuid(),
        workspace_id: WorkspaceIdSchema,
        manual_id: ManualIdSchema,
        expires_at: z.date(),
      })
      .parse(row);
    const sessionToken = freshToken(),
      sessionId = SessionIdSchema.parse(newId());
    await db.query(
      "INSERT INTO sessions(id,workspace_id,token_hash,role,share_id,expires_at) VALUES($1,$2,$3,'reader',$4,$5)",
      [sessionId, share.workspace_id, tokenHash(sessionToken), share.id, share.expires_at],
    );
    return {
      token: sessionToken,
      sessionId,
      workspaceId: share.workspace_id,
      manualId: share.manual_id,
      expiresAt: share.expires_at,
    };
  });
}
export async function revokeShare(owner: SessionContext, id: string): Promise<void> {
  await transaction(async (db) => {
    await assertSession(db, owner, true);
    const result = await db.query(
      "UPDATE shares SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND workspace_id=$2",
      [id, owner.workspaceId],
    );
    if (!result.rowCount) throw new AppError("not_found", 404, "공유를 찾을 수 없습니다.");
  });
}
