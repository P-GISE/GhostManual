import { z } from "zod";
import { EmailSchema, SESSION_DAYS } from "./accounts.ts";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { sendMail } from "./mailer.ts";
import { removeWorkspace } from "./retention.ts";
import { freshToken, lockAccountSession, tokenHash } from "./session.ts";
import { newId, type SessionContext } from "./types.ts";

export const TeamNameSchema = z.string().trim().min(1).max(40);
const MAX_ADMIN_TEAMS = 5;
const MAX_MEMBERS = 30;
const INVITE_DAYS = 7;

const missing = () => new AppError("not_found", 404, "팀 문서함을 찾을 수 없습니다.");
// 팀 기능은 로그인한 계정만 쓴다. 공유 독자와 계정 없는 임시 문서함에는 없는 기능처럼 보인다.
function account(ctx: SessionContext): string {
  if (ctx.role !== "owner" || !ctx.userId) throw missing();
  return ctx.userId;
}
// 팀 행을 잠그고 요청한 사람의 역할을 돌려준다. 팀원이 아니면 404, 관리자가 필요한데 아니면 403.
// 역할 변경·나가기·내보내기·초대가 모두 이 잠금 뒤에서 마지막 관리자와 정원을 검사한다.
async function lockTeam(db: DbClient, userId: string, teamId: string, adminOnly = false) {
  const team = await db.query<{ team_name: string }>(
    "SELECT team_name FROM workspaces WHERE id=$1 AND team_name IS NOT NULL FOR UPDATE",
    [teamId],
  );
  const member = await db.query<{ role: "admin" | "member" }>(
    "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    [teamId, userId],
  );
  const role = member.rows[0]?.role;
  if (!team.rows[0] || !role) throw missing();
  if (adminOnly && role !== "admin")
    throw new AppError("forbidden", 403, "팀 관리자만 할 수 있습니다.");
  return { name: team.rows[0].team_name, role };
}
async function assertOtherAdmin(db: DbClient, teamId: string, userId: string) {
  const others = await db.query(
    "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND role='admin' AND user_id<>$2",
    [teamId, userId],
  );
  if (!others.rowCount)
    throw new AppError(
      "last_admin",
      409,
      "팀 관리자가 한 명뿐입니다. 다른 관리자를 지정하거나 팀을 삭제하세요.",
    );
}

export async function listWorkspaces(ctx: SessionContext) {
  const userId = account(ctx);
  return transaction(async (db) => {
    await lockAccountSession(db, ctx);
    const { rows } = await db.query<{ id: string; name: string | null; role: string | null }>(
      `SELECT w.id,w.team_name AS name,m.role FROM workspaces w
        LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1
        WHERE w.user_id=$1 OR m.user_id=$1 ORDER BY w.team_name NULLS FIRST,w.id`,
      [userId],
    );
    return rows.map((row) => ({ ...row, current: row.id === ctx.workspaceId }));
  });
}

export async function createTeam(ctx: SessionContext, input: unknown) {
  const userId = account(ctx);
  const name = TeamNameSchema.parse(input);
  return transaction(async (db) => {
    // 같은 사람이 동시에 여러 번 만들어도 개수 제한이 지켜지도록 계정 행을 잠근다.
    await lockAccountSession(db, ctx, ctx.workspaceId, true);
    const count = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM workspace_members WHERE user_id=$1 AND role='admin'",
      [userId],
    );
    if (Number(count.rows[0]?.count) >= MAX_ADMIN_TEAMS)
      throw new AppError("team_limit", 409, "관리하는 팀 문서함은 5개까지 만들 수 있습니다.");
    const id = newId();
    await db.query(
      "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank',$2,'infinity')",
      [id, name],
    );
    await db.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
      [id, userId],
    );
    return { id, name, role: "admin" as const };
  });
}

// 이전 세션 행은 질문과 작업을 위해 보존하고 브라우저 토큰만 폐기한다.
// 팀에서 내보내진 직후에도 내 문서함으로 돌아올 수 있도록, 토큰의 계정만 확인하고 현재 문서함의 팀원인지는 보지 않는다.
export async function switchWorkspace(token: string, workspaceId: string | null) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError("unauthorized", 401, "로그인이 필요합니다.");
  return transaction(async (db) => {
    const session = await db.query<{ user_id: string }>(
      "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.role='owner' AND s.expires_at>now() AND u.terms_agreed_at IS NOT NULL",
      [tokenHash(token)],
    );
    const userId = session.rows[0]?.user_id;
    if (!userId) throw new AppError("unauthorized", 401, "로그인이 필요합니다.");
    const target = await db.query<{ id: string }>(
      workspaceId === null
        ? "SELECT id FROM workspaces WHERE user_id=$1 AND team_name IS NULL"
        : "SELECT w.id FROM workspaces w WHERE w.id=$2 AND (w.user_id=$1 OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$1))",
      workspaceId === null ? [userId] : [userId, workspaceId],
    );
    const id = target.rows[0]?.id;
    if (!id) throw missing();
    const next = freshToken();
    const created = await db.query<{ expires_at: Date }>(
      `INSERT INTO sessions(id,workspace_id,token_hash,role,user_id,expires_at) VALUES($1,$2,$3,'owner',$4,now()+interval '${SESSION_DAYS} days') RETURNING expires_at`,
      [newId(), id, tokenHash(next), userId],
    );
    const revoked = await db.query(
      "UPDATE sessions SET token_hash=$2 WHERE token_hash=$1 AND role='owner' AND expires_at>now()",
      [tokenHash(token), tokenHash(freshToken())],
    );
    if (!revoked.rowCount) throw new AppError("unauthorized", 401, "로그인이 필요합니다.");
    return { token: next, expiresAt: z.date().parse(created.rows[0]?.expires_at), workspaceId: id };
  });
}

export async function renameTeam(ctx: SessionContext, teamId: string, input: unknown) {
  const userId = account(ctx);
  const name = TeamNameSchema.parse(input);
  await transaction(async (db) => {
    await lockAccountSession(db, ctx, teamId);
    await lockTeam(db, userId, teamId, true);
    await db.query("UPDATE workspaces SET team_name=$2 WHERE id=$1", [teamId, name]);
  });
  return { id: teamId, name };
}

// 팀의 모든 자료가 영구 삭제된다. 팀 이름을 그대로 입력해야 한다.
export async function deleteTeam(ctx: SessionContext, teamId: string, confirmName: unknown) {
  const userId = account(ctx);
  await transaction(async (db) => {
    await lockAccountSession(db, ctx, teamId);
    const team = await lockTeam(db, userId, teamId, true);
    if (confirmName !== team.name)
      throw new AppError("invalid_input", 422, "팀 이름을 정확히 입력하세요.");
    await removeWorkspace(db, teamId);
  });
}

export async function listMembers(ctx: SessionContext, teamId: string) {
  const userId = account(ctx);
  return transaction(async (db) => {
    await lockAccountSession(db, ctx, teamId);
    const team = await lockTeam(db, userId, teamId);
    const admin = team.role === "admin";
    const members = await db.query(
      `SELECT u.id,u.name,u.department,m.role,m.joined_at AS "joinedAt"${admin ? ",u.email" : ""}
        FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.joined_at,u.id`,
      [teamId],
    );
    // 초대한 이메일은 팀 관리자에게만 보인다.
    const invites = admin
      ? await db.query(
          `SELECT id,email,expires_at AS "expiresAt",expires_at<=now() AS expired FROM workspace_invites WHERE workspace_id=$1 AND accepted_at IS NULL ORDER BY created_at`,
          [teamId],
        )
      : { rows: [] };
    return {
      id: teamId,
      name: team.name,
      role: team.role,
      members: members.rows,
      invites: invites.rows,
    };
  });
}

export async function changeRole(
  ctx: SessionContext,
  teamId: string,
  targetId: string,
  role: "admin" | "member",
) {
  const userId = account(ctx);
  await transaction(async (db) => {
    await lockAccountSession(db, ctx, teamId);
    await lockTeam(db, userId, teamId, true);
    if (role === "member") await assertOtherAdmin(db, teamId, targetId);
    const updated = await db.query(
      "UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
      [teamId, targetId, role],
    );
    if (!updated.rowCount) throw new AppError("not_found", 404, "팀원을 찾을 수 없습니다.");
  });
}

// 본인이면 나가기, 다른 사람이면 내보내기(관리자만). 자료는 팀에 남는다.
export async function removeMember(ctx: SessionContext, teamId: string, targetId: string) {
  const userId = account(ctx);
  await transaction(async (db) => {
    await lockAccountSession(db, ctx, teamId);
    await lockTeam(db, userId, teamId, targetId !== userId);
    const target = await db.query<{ role: string }>(
      "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
      [teamId, targetId],
    );
    if (!target.rows[0]) throw new AppError("not_found", 404, "팀원을 찾을 수 없습니다.");
    if (target.rows[0].role === "admin") await assertOtherAdmin(db, teamId, targetId);
    await db.query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [
      teamId,
      targetId,
    ]);
    // 떠난 사람의 팀 세션과 그 세션의 질문 기록(개인 기록)을 함께 지운다.
    await db.query("DELETE FROM sessions WHERE workspace_id=$1 AND user_id=$2", [teamId, targetId]);
  });
}

// 초대는 이메일 주소에 묶인다. 가입 여부는 응답으로 알려 주지 않는다.
export async function inviteMember(ctx: SessionContext, teamId: string, input: unknown) {
  const userId = account(ctx);
  const email = EmailSchema.parse(input);
  const token = freshToken();
  const invite = await transaction(async (db) => {
    await lockAccountSession(db, ctx, teamId);
    const team = await lockTeam(db, userId, teamId, true);
    const already = await db.query(
      "SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND u.email=$2",
      [teamId, email],
    );
    if (already.rowCount) throw new AppError("conflict", 409, "이미 팀원인 사람입니다.");
    // 다시 보내기: 열려 있는 이전 초대(만료된 것 포함)를 지우고 새 토큰으로 만든다.
    await db.query(
      "DELETE FROM workspace_invites WHERE workspace_id=$1 AND email=$2 AND accepted_at IS NULL",
      [teamId, email],
    );
    const count = await db.query<{ count: number }>(
      `SELECT (SELECT count(*) FROM workspace_members WHERE workspace_id=$1)
        +(SELECT count(*) FROM workspace_invites WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now()) AS count`,
      [teamId],
    );
    if (Number(count.rows[0]?.count) >= MAX_MEMBERS)
      throw new AppError("team_limit", 409, "팀원은 초대 중인 사람을 포함해 30명까지입니다.");
    const id = newId();
    const created = await db.query<{ expires_at: Date }>(
      `INSERT INTO workspace_invites(id,workspace_id,email,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '${INVITE_DAYS} days') RETURNING expires_at`,
      [id, teamId, email, tokenHash(token), userId],
    );
    const inviter = await db.query<{ name: string }>("SELECT name FROM users WHERE id=$1", [
      userId,
    ]);
    return {
      id,
      team: team.name,
      inviter: inviter.rows[0]?.name ?? "",
      expiresAt: z.date().parse(created.rows[0]?.expires_at),
    };
  });
  const origin = process.env["APP_ORIGIN"] ?? "";
  await sendMail(
    email,
    `[GhostManual] ${invite.team} 팀 문서함 초대`,
    `${invite.inviter} 님이 GhostManual의 "${invite.team}" 팀 문서함에 초대했습니다.\n\n아래 링크를 열고 이 이메일 주소의 계정으로 로그인하면 팀 문서함에 들어갑니다. 계정이 없으면 이 이메일 주소로 가입한 뒤 링크를 다시 여세요.\n\n${origin}/invite#${token}\n\n링크는 ${INVITE_DAYS}일 동안 유효합니다. 초대받은 적이 없다면 이 메일을 무시하세요.`,
  );
  return { id: invite.id, email, expiresAt: invite.expiresAt };
}

export async function cancelInvite(ctx: SessionContext, teamId: string, inviteId: string) {
  const userId = account(ctx);
  await transaction(async (db) => {
    await lockAccountSession(db, ctx, teamId);
    await lockTeam(db, userId, teamId, true);
    const removed = await db.query(
      "DELETE FROM workspace_invites WHERE id=$1 AND workspace_id=$2 AND accepted_at IS NULL",
      [inviteId, teamId],
    );
    if (!removed.rowCount) throw new AppError("not_found", 404, "초대를 찾을 수 없습니다.");
  });
}

// 초대받은 이메일의 계정으로 로그인한 사람만 수락할 수 있다.
export async function acceptInvite(ctx: SessionContext, token: unknown) {
  const userId = account(ctx);
  const parsed = z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .safeParse(token);
  const invalid = () =>
    new AppError("invalid_invite", 404, "초대 링크가 만료됐거나 이미 사용됐습니다.");
  if (!parsed.success) throw invalid();
  return transaction(async (db) => {
    const found = await db.query<{ id: string; workspace_id: string; email: string }>(
      "SELECT id,workspace_id,email FROM workspace_invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()",
      [tokenHash(parsed.data)],
    );
    const invite = found.rows[0];
    if (!invite) throw invalid();
    await lockAccountSession(db, ctx, invite.workspace_id);
    const live = await db.query(
      "SELECT id FROM workspace_invites WHERE id=$1 AND token_hash=$2 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE",
      [invite.id, tokenHash(parsed.data)],
    );
    if (!live.rowCount) throw invalid();
    const team = await db.query<{ team_name: string }>(
      "SELECT team_name FROM workspaces WHERE id=$1 AND team_name IS NOT NULL",
      [invite.workspace_id],
    );
    const user = await db.query<{ email: string }>(
      "SELECT email FROM users WHERE id=$1 AND email_verified_at IS NOT NULL",
      [userId],
    );
    if (!team.rows[0]) throw invalid();
    if (user.rows[0]?.email !== invite.email)
      throw new AppError(
        "invite_email_mismatch",
        403,
        "초대받은 이메일 주소의 계정으로 로그인한 뒤 다시 여세요.",
      );
    await db.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",
      [invite.workspace_id, userId],
    );
    await db.query("UPDATE workspace_invites SET accepted_at=now() WHERE id=$1", [invite.id]);
    return { id: invite.workspace_id, name: team.rows[0].team_name };
  });
}
