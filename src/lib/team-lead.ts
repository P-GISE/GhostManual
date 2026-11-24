import type { DbClient } from "./db.ts";
import { AppError } from "./errors.ts";

export async function teamLeadEnforced(db: DbClient): Promise<boolean> {
  const result = await db.query<{ ready: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name='014_team_lead_enforce.sql') AS ready",
  );
  return result.rows[0]?.ready === true;
}

export async function assertNotTeamLead(db: DbClient, userId: string, teamId?: string) {
  if (!(await teamLeadEnforced(db))) return;
  const lead = await db.query(
    "SELECT 1 FROM workspaces WHERE lead_user_id=$1 AND ($2::uuid IS NULL OR id=$2)",
    [userId, teamId ?? null],
  );
  if (lead.rowCount)
    throw new AppError(
      "lead_transfer_required",
      409,
      "다른 팀원에게 대표 권한을 이양한 뒤 진행하세요.",
    );
}
