import { z } from "zod";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertSession, freshToken, tokenHash } from "./session.ts";
import {
  ManualIdSchema,
  newId,
  type SessionContext,
  SessionIdSchema,
  WorkspaceIdSchema,
} from "./types.ts";

export type Sharing = { mode: "private" } | { mode: "link"; url: string };
async function activeLink(db: DbClient, owner: SessionContext, manualId: string) {
  const result = await db.query<{ link_token: string | null }>(
    "SELECT link_token FROM shares WHERE workspace_id=$1 AND manual_id=$2 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
    [owner.workspaceId, manualId],
  );
  return result.rows[0]?.link_token ?? null;
}
async function ownedManual(db: DbClient, owner: SessionContext, manualId: string) {
  const found = await db.query("SELECT id FROM manuals WHERE id=$1 AND workspace_id=$2", [
    manualId,
    owner.workspaceId,
  ]);
  if (!found.rowCount) throw new AppError("not_found", 404, "매뉴얼을 찾을 수 없습니다.");
}
function sharingOf(token: string | null): Sharing {
  return token ? { mode: "link", url: `/share#${token}` } : { mode: "private" };
}
export async function getSharing(owner: SessionContext, manualId: string): Promise<Sharing> {
  return transaction(async (db) => {
    await assertSession(db, owner, true);
    await ownedManual(db, owner, manualId);
    return sharingOf(await activeLink(db, owner, manualId));
  });
}
// Colab-style: one stable link while sharing is on; turning it off revokes every link.
export async function setSharing(
  owner: SessionContext,
  manualId: string,
  mode: Sharing["mode"],
): Promise<Sharing> {
  return transaction(async (db) => {
    await assertSession(db, owner, true);
    await ownedManual(db, owner, manualId);
    if (mode === "private") {
      await db.query(
        "UPDATE shares SET revoked_at=now() WHERE workspace_id=$1 AND manual_id=$2 AND revoked_at IS NULL",
        [owner.workspaceId, manualId],
      );
      return sharingOf(null);
    }
    const existing = await activeLink(db, owner, manualId);
    if (existing) return sharingOf(existing);
    const reviewed = await db.query(
      "SELECT id FROM manuals WHERE id=$1 AND workspace_id=$2 AND published_version IS NOT NULL AND needs_review=false",
      [manualId, owner.workspaceId],
    );
    if (!reviewed.rowCount)
      throw new AppError("not_found", 404, "검수한 매뉴얼을 찾을 수 없습니다.");
    const token = freshToken();
    await db.query(
      "INSERT INTO shares(id,workspace_id,manual_id,token_hash,link_token,expires_at) SELECT $1,w.id,$2,$3,$4,w.expires_at FROM workspaces w WHERE w.id=$5",
      [newId(), manualId, tokenHash(token), token, owner.workspaceId],
    );
    return sharingOf(token);
  });
}
const loginRequired = () => new AppError("login_required", 401, "공유 문서를 보려면 로그인하세요.");
export async function exchangeShare(token: string, viewer: SessionContext) {
  if (viewer.role !== "owner") throw loginRequired();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError("share_unavailable", 401, "공유가 만료되거나 취소됐습니다.");
  return transaction(async (db) => {
    const account = await db.query<{ user_id: string | null }>(
      "SELECT user_id FROM sessions WHERE id=$1 AND role='owner' AND expires_at>now()",
      [viewer.sessionId],
    );
    const userId = account.rows[0]?.user_id;
    if (!userId) throw loginRequired();
    const result = await db.query<Record<string, unknown>>(
      `SELECT sh.id,sh.workspace_id,sh.manual_id,LEAST(sh.expires_at,w.expires_at,now()+interval '30 days') AS expires_at FROM shares sh JOIN workspaces w ON w.id=sh.workspace_id JOIN manuals m ON m.id=sh.manual_id WHERE sh.token_hash=$1 AND sh.revoked_at IS NULL AND sh.expires_at>now() AND w.expires_at>now() AND m.published_version IS NOT NULL AND m.needs_review=false FOR UPDATE OF w`,
      [tokenHash(token)],
    );
    const row = result.rows[0];
    if (!row) throw new AppError("share_unavailable", 401, "공유가 만료되거나 취소됐습니다.");
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
      "INSERT INTO sessions(id,workspace_id,token_hash,role,share_id,user_id,expires_at) VALUES($1,$2,$3,'reader',$4,$5,$6)",
      [sessionId, share.workspace_id, tokenHash(sessionToken), share.id, userId, share.expires_at],
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
