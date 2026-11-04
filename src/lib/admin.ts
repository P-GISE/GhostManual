import { z } from "zod";
import { FILE_QUOTA_BYTES } from "./accounts.ts";
import { type DbClient, pool, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertSession } from "./session.ts";
import { newId, type SessionContext } from "./types.ts";

// Accounts listed in ADMIN_EMAILS are always admins and cannot be demoted from the page.
function envAdmins(): Set<string> {
  return new Set(
    (process.env["ADMIN_EMAILS"] ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
export function adminSource(email: string, isAdmin: boolean): "env" | "db" | null {
  return envAdmins().has(email) ? "env" : isAdmin ? "db" : null;
}

const day = "(now() AT TIME ZONE 'UTC')::date";
const userRow = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  department: z.string().nullable(),
  created_at: z.date(),
  verified: z.boolean(),
  is_admin: z.boolean(),
  ai_allowed: z.boolean(),
  storage_limit_bytes: z.coerce.number().nullable(),
  sources: z.coerce.number(),
  manuals: z.coerce.number(),
  published: z.coerce.number(),
  bytes: z.coerce.number(),
  ai_today: z.coerce.number(),
});
const userSelect = `SELECT u.id,u.name,u.email,u.department,u.created_at,u.email_verified_at IS NOT NULL AS verified,
  u.is_admin,u.ai_allowed,u.storage_limit_bytes,
  (SELECT count(*) FROM sources s WHERE s.workspace_id=w.id) AS sources,
  (SELECT count(*) FROM manuals m WHERE m.workspace_id=w.id) AS manuals,
  (SELECT count(*) FROM manuals m WHERE m.workspace_id=w.id AND m.published_version IS NOT NULL) AS published,
  (SELECT COALESCE(sum(size_bytes),0) FROM source_files f WHERE f.workspace_id=w.id) AS bytes,
  (SELECT COALESCE(sum(attempts),0) FROM usage_counters c WHERE c.scope=w.id::text AND c.day=${day}) AS ai_today
  FROM users u LEFT JOIN workspaces w ON w.user_id=u.id`;
function view(row: unknown) {
  const r = userRow.parse(row);
  const source = adminSource(r.email, r.is_admin);
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    department: r.department,
    createdAt: r.created_at.toISOString(),
    verified: r.verified,
    admin: source !== null,
    adminSource: source,
    aiAllowed: r.ai_allowed,
    sources: r.sources,
    manuals: r.manuals,
    published: r.published,
    usage: { bytes: r.bytes, limitBytes: r.storage_limit_bytes ?? FILE_QUOTA_BYTES },
    customLimit: r.storage_limit_bytes !== null,
    aiToday: r.ai_today,
  };
}
export type AdminUser = ReturnType<typeof view>;

// Admin status is recomputed from the session's account on every request; reader sessions never qualify.
async function requireAdmin(db: DbClient, ctx: SessionContext): Promise<string> {
  await assertSession(db, ctx, true);
  const me = await db.query<{ id: string; email: string; is_admin: boolean }>(
    "SELECT u.id,u.email,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1",
    [ctx.sessionId],
  );
  const row = me.rows[0];
  if (!row || !adminSource(row.email, row.is_admin))
    throw new AppError("forbidden", 403, "관리자만 볼 수 있습니다.");
  return row.id;
}
export async function listUsers(ctx: SessionContext): Promise<AdminUser[]> {
  return transaction(async (db) => {
    await requireAdmin(db, ctx);
    return (await db.query(`${userSelect} ORDER BY u.created_at DESC`)).rows.map(view);
  });
}
const UpdateSchema = z
  .strictObject({
    admin: z.boolean().optional(),
    aiAllowed: z.boolean().optional(),
    storageLimitBytes: z.number().int().min(1048576).max(1073741824).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export async function updateUser(
  ctx: SessionContext,
  targetId: string,
  input: unknown,
): Promise<AdminUser> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) throw new AppError("invalid_input", 422, "바꿀 권한 값을 확인하세요.");
  const change = parsed.data;
  return transaction(async (db) => {
    const adminId = await requireAdmin(db, ctx);
    const found = await db.query<{
      email: string;
      is_admin: boolean;
      ai_allowed: boolean;
      storage_limit_bytes: string | null;
    }>("SELECT email,is_admin,ai_allowed,storage_limit_bytes FROM users WHERE id=$1 FOR UPDATE", [
      targetId,
    ]);
    const before = found.rows[0];
    if (!before) throw new AppError("not_found", 404, "사용자를 찾을 수 없습니다.");
    if (change.admin === false && (targetId === adminId || envAdmins().has(before.email)))
      throw new AppError(
        "invalid_input",
        400,
        "내 관리자 권한과 서버 설정 관리자는 여기서 해제할 수 없습니다.",
      );
    const edits: { field: string; column: string; from: unknown; to: unknown }[] = [];
    if (change.admin !== undefined && change.admin !== before.is_admin)
      edits.push({ field: "admin", column: "is_admin", from: before.is_admin, to: change.admin });
    if (change.aiAllowed !== undefined && change.aiAllowed !== before.ai_allowed)
      edits.push({
        field: "aiAllowed",
        column: "ai_allowed",
        from: before.ai_allowed,
        to: change.aiAllowed,
      });
    const limitBefore =
      before.storage_limit_bytes === null ? null : Number(before.storage_limit_bytes);
    if (change.storageLimitBytes !== undefined && change.storageLimitBytes !== limitBefore)
      edits.push({
        field: "storageLimitBytes",
        column: "storage_limit_bytes",
        from: limitBefore,
        to: change.storageLimitBytes,
      });
    for (const edit of edits) {
      // Column names come from the fixed list above, never from input.
      await db.query(`UPDATE users SET ${edit.column}=$1 WHERE id=$2`, [edit.to, targetId]);
      await db.query(
        "INSERT INTO admin_events(id,admin_user_id,target_user_id,change) VALUES($1,$2,$3,$4)",
        [
          newId(),
          adminId,
          targetId,
          JSON.stringify({ field: edit.field, from: edit.from, to: edit.to }),
        ],
      );
    }
    return view((await db.query(`${userSelect} WHERE u.id=$1`, [targetId])).rows[0]);
  });
}
export async function aiUsage(ctx: SessionContext, days: number) {
  const n = z.number().int().min(1).max(60).parse(days);
  return transaction(async (db) => {
    await requireAdmin(db, ctx);
    const rows = await db.query<{ day: string; total: number }>(
      `SELECT to_char(d,'YYYY-MM-DD') AS day,COALESCE(c.attempts,0)::int AS total
       FROM generate_series(${day}-($1::int-1),${day},interval '1 day') d
       LEFT JOIN usage_counters c ON c.day=d::date AND c.scope='global' AND c.kind='all' ORDER BY d`,
      [n],
    );
    return { days: rows.rows, dailyLimit: Number(process.env["AI_DAILY_LIMIT"] ?? 100) };
  });
}
export async function adminEvents(ctx: SessionContext, limit: number) {
  const n = z.number().int().min(1).max(200).parse(limit);
  return transaction(async (db) => {
    await requireAdmin(db, ctx);
    const rows = await db.query<{
      id: string;
      created_at: Date;
      admin_name: string | null;
      target_name: string | null;
      change: { field: string; from: unknown; to: unknown };
    }>(
      `SELECT e.id,e.created_at,a.name AS admin_name,t.name AS target_name,e.change
       FROM admin_events e LEFT JOIN users a ON a.id=e.admin_user_id LEFT JOIN users t ON t.id=e.target_user_id
       ORDER BY e.created_at DESC LIMIT $1`,
      [n],
    );
    return rows.rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      adminName: r.admin_name,
      targetName: r.target_name,
      ...r.change,
    }));
  });
}
// The workspace owner's settings: guest (non-account) workspaces keep the defaults.
async function ownerSettings(db: Pick<DbClient, "query">, workspaceId: string) {
  const row = await db.query<{ ai_allowed: boolean; storage_limit_bytes: string | null }>(
    "SELECT u.ai_allowed,u.storage_limit_bytes FROM workspaces w JOIN users u ON u.id=w.user_id WHERE w.id=$1",
    [workspaceId],
  );
  return row.rows[0];
}
export async function workspaceAiAllowed(
  workspaceId: string,
  db: Pick<DbClient, "query"> = pool,
): Promise<boolean> {
  return (await ownerSettings(db, workspaceId))?.ai_allowed ?? true;
}
export async function workspaceStorageLimit(db: DbClient, workspaceId: string): Promise<number> {
  const limit = (await ownerSettings(db, workspaceId))?.storage_limit_bytes;
  return limit ? Number(limit) : FILE_QUOTA_BYTES;
}
export async function sessionIsAdmin(db: DbClient, ctx: SessionContext): Promise<boolean> {
  const me = await db.query<{ email: string; is_admin: boolean }>(
    "SELECT u.email,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1",
    [ctx.sessionId],
  );
  const row = me.rows[0];
  return !!row && adminSource(row.email, row.is_admin) !== null;
}
