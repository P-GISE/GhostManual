import { z } from "zod";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertSession } from "./session.ts";
import type { SessionContext } from "./types.ts";

export async function removeWorkspace(db: DbClient, id: string) {
  await db.query("DELETE FROM operation_requests WHERE workspace_id=$1", [id]);
  await db.query("DELETE FROM question_runs WHERE workspace_id=$1", [id]);
  await db.query("UPDATE manuals SET published_version=NULL WHERE workspace_id=$1", [id]);
  await db.query("DELETE FROM manuals WHERE workspace_id=$1", [id]);
  await db.query("DELETE FROM workspaces WHERE id=$1", [id]);
}
export async function deleteWorkspace(owner: SessionContext): Promise<void> {
  // 팀 문서함은 팀 이름을 확인하는 팀 삭제로만 지운다(teams.ts의 deleteTeam).
  if (owner.teamRole !== null)
    throw new AppError("forbidden", 403, "팀 문서함은 팀 설정에서 삭제하세요.");
  await transaction(async (db) => {
    await assertSession(db, owner, true);
    await removeWorkspace(db, owner.workspaceId);
  });
}
export async function deleteSource(owner: SessionContext, id: string): Promise<void> {
  await transaction(async (db) => {
    await assertSession(db, owner, true);
    const found = await db.query<{ created_by: string | null }>(
      "SELECT created_by FROM sources WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [id, owner.workspaceId],
    );
    if (!found.rows[0]) throw new AppError("not_found", 404, "자료를 찾을 수 없습니다.");
    if (owner.teamRole === "member" && found.rows[0].created_by !== owner.userId)
      throw new AppError("forbidden", 403, "올린 사람과 팀 관리자만 이 업무를 삭제할 수 있습니다.");
    await db.query(
      `DELETE FROM question_runs WHERE workspace_id=$1 AND (
        id IN (SELECT question_id FROM evidence WHERE source_id=$2)
        OR result @> $3::jsonb OR result @> $4::jsonb
      )`,
      [
        owner.workspaceId,
        id,
        JSON.stringify({ evidence: [{ sourceId: id }] }),
        JSON.stringify({ searchResults: [{ sourceId: id }] }),
      ],
    );
    await db.query("DELETE FROM operation_requests WHERE workspace_id=$1", [owner.workspaceId]);
    await db.query("UPDATE manuals SET published_version=NULL WHERE source_id=$1", [id]);
    await db.query("DELETE FROM manuals WHERE source_id=$1", [id]);
    await db.query("DELETE FROM sources WHERE id=$1", [id]);
  });
}
export async function cleanupExpired(now: Date) {
  return transaction(async (db) => {
    const expired = await db.query<Record<string, unknown>>(
      "SELECT id FROM workspaces WHERE team_name IS NULL AND expires_at<=$1 FOR UPDATE",
      [now],
    );
    for (const row of expired.rows) await removeWorkspace(db, z.uuid().parse(row["id"]));
    await db.query(
      "DELETE FROM operation_requests WHERE session_id IN (SELECT s.id FROM sessions s LEFT JOIN shares sh ON sh.id=s.share_id WHERE s.expires_at<=$1 OR sh.expires_at<=$1)",
      [now],
    );
    const shares = await db.query("DELETE FROM shares WHERE expires_at<=$1", [now]);
    const sessions = await db.query("DELETE FROM sessions WHERE expires_at<=$1", [now]);
    const rateCounters = await db.query("DELETE FROM rate_counters WHERE expires_at<=$1", [now]);
    return {
      workspaces: expired.rowCount ?? 0,
      shares: shares.rowCount ?? 0,
      sessions: sessions.rowCount ?? 0,
      rateCounters: rateCounters.rowCount ?? 0,
    };
  });
}
