import { z } from "zod";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { sendMail } from "./mailer.ts";
import { safeNextPath } from "./next-path.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { removeWorkspace } from "./retention.ts";
import { assertSession, freshToken, tokenHash } from "./session.ts";
import { newId, type SessionContext } from "./types.ts";

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const PasswordSchema = z.string().min(8).max(128);
export const SignupSchema = z.strictObject({
  email: EmailSchema,
  name: z.string().trim().min(1).max(40),
  password: PasswordSchema,
  next: z.string().max(2048).optional(),
  agreed: z.literal(true),
});
const SESSION_DAYS = 30;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const invalidLink = () =>
  new AppError("invalid_link", 400, "인증 링크가 만료됐거나 이미 사용됐습니다.");

export async function openUserSession(db: DbClient, userId: string) {
  const existing = await db.query<{ id: string }>("SELECT id FROM workspaces WHERE user_id=$1", [
    userId,
  ]);
  let workspaceId = existing.rows[0]?.id;
  if (!workspaceId) {
    workspaceId = newId();
    await db.query(
      "INSERT INTO workspaces(id,mode,user_id,expires_at) VALUES($1,'blank',$2,'infinity')",
      [workspaceId, userId],
    );
  }
  const token = freshToken();
  const result = await db.query<Record<string, unknown>>(
    `INSERT INTO sessions(id,workspace_id,token_hash,role,user_id,expires_at) VALUES($1,$2,$3,'owner',$4,now()+interval '${SESSION_DAYS} days') RETURNING expires_at`,
    [newId(), workspaceId, tokenHash(token), userId],
  );
  return { token, expiresAt: z.date().parse(result.rows[0]?.["expires_at"]) };
}
async function issueVerification(db: DbClient, userId: string) {
  await db.query(
    "UPDATE email_verifications SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
    [userId],
  );
  const token = freshToken();
  await db.query(
    "INSERT INTO email_verifications(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",
    [newId(), userId, tokenHash(token)],
  );
  return token;
}
// A same-site destination (such as a shared manual) survives signup and verification.
async function mailVerification(email: string, token: string, next: string | undefined) {
  const destination = safeNextPath(next);
  const link = `${process.env["APP_ORIGIN"]}/api/auth/verify?token=${token}${destination === "/manuals" ? "" : `&next=${encodeURIComponent(destination)}`}`;
  await sendMail(
    email,
    "GhostManual 이메일 인증",
    `GhostManual 가입을 완료하려면 24시간 안에 아래 링크를 여세요.\n\n${link}\n\n가입하지 않았다면 이 메일을 무시하세요.`,
  );
}
export async function signup(input: z.input<typeof SignupSchema>): Promise<void> {
  const { email, name, password, next } = SignupSchema.parse(input);
  const passwordHash = await hashPassword(password);
  const token = await transaction(async (db) => {
    const result = await db.query<{ id: string }>(
      "INSERT INTO users(id,email,name,password_hash,terms_agreed_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,terms_agreed_at=now() WHERE users.email_verified_at IS NULL RETURNING id",
      [newId(), email, name, passwordHash],
    );
    const userId = result.rows[0]?.id;
    return userId ? issueVerification(db, userId) : null;
  });
  if (token) await mailVerification(email, token, next);
  // Same screen either way; only the mailbox owner learns the account already exists.
  else
    await sendMail(
      email,
      "GhostManual 가입 안내",
      `이 이메일로 이미 가입된 계정이 있습니다. 아래에서 로그인하세요.

${process.env["APP_ORIGIN"]}/login

Google 계정으로 가입했다면 로그인 화면의 "Google 계정으로 계속하기"를 사용하세요. 가입을 시도하지 않았다면 이 메일을 무시하세요.`,
    );
}
export async function resendVerification(input: string, next?: string): Promise<void> {
  const email = EmailSchema.parse(input);
  const token = await transaction(async (db) => {
    const user = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE email=$1 AND email_verified_at IS NULL FOR UPDATE",
      [email],
    );
    const userId = user.rows[0]?.id;
    return userId ? issueVerification(db, userId) : null;
  });
  if (token) await mailVerification(email, token, next);
}
export async function verifyEmail(token: string) {
  if (!tokenPattern.test(token)) throw invalidLink();
  return transaction(async (db) => {
    const found = await db.query<{ id: string; user_id: string }>(
      "SELECT id,user_id FROM email_verifications WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
      [tokenHash(token)],
    );
    const row = found.rows[0];
    if (!row) throw invalidLink();
    await db.query("UPDATE email_verifications SET used_at=now() WHERE id=$1", [row.id]);
    await db.query(
      "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
      [row.user_id],
    );
    return openUserSession(db, row.user_id);
  });
}
const badCredentials = () =>
  new AppError("invalid_credentials", 401, "이메일 또는 비밀번호가 올바르지 않습니다.");
// Spend the same hashing time when the account does not exist.
const decoyHash = hashPassword("decoy password for timing");
export async function login(rawEmail: string, password: string) {
  const email = EmailSchema.safeParse(rawEmail);
  return transaction(async (db) => {
    const found = email.success
      ? await db.query<{
          id: string;
          password_hash: string | null;
          email_verified_at: Date | null;
        }>("SELECT id,password_hash,email_verified_at FROM users WHERE email=$1", [email.data])
      : null;
    const user = found?.rows[0];
    const valid = await verifyPassword(password, user?.password_hash ?? (await decoyHash));
    if (!user?.password_hash || !valid) throw badCredentials();
    if (!user.email_verified_at)
      throw new AppError("unverified", 403, "이메일 인증을 먼저 완료하세요.");
    return {
      ...(await openUserSession(db, user.id)),
      termsRequired: await termsPending(db, user.id),
    };
  });
}
export async function logout(ctx: SessionContext): Promise<void> {
  await transaction(async (db) => {
    await db.query("DELETE FROM sessions WHERE id=$1", [ctx.sessionId]);
  });
}
export async function currentUser(ctx: SessionContext) {
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    // Accounts older than an hour existed before terms consent; the welcome screen must not delete them.
    const result = await db.query<{ name: string; email: string; newAccount: boolean }>(
      `SELECT u.name,u.email,u.created_at>now()-interval '1 hour' AS "newAccount" FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1`,
      [ctx.sessionId],
    );
    const user = result.rows[0];
    if (!user) throw new AppError("unauthorized", 401, "로그인이 필요합니다.");
    return user;
  });
}
export async function deleteAccount(ctx: SessionContext): Promise<void> {
  await transaction(async (db) => {
    await assertSession(db, ctx, true);
    const result = await db.query<{ user_id: string | null }>(
      "SELECT user_id FROM sessions WHERE id=$1",
      [ctx.sessionId],
    );
    const userId = result.rows[0]?.user_id;
    if (!userId) throw new AppError("unauthorized", 401, "로그인이 필요합니다.");
    await removeWorkspace(db, ctx.workspaceId);
    await db.query("DELETE FROM users WHERE id=$1", [userId]);
  });
}
const invalidReset = () =>
  new AppError("invalid_link", 400, "재설정 링크가 만료됐거나 이미 사용됐습니다.");
export async function requestPasswordReset(input: string): Promise<void> {
  const email = EmailSchema.safeParse(input);
  if (!email.success) return;
  const token = await transaction(async (db) => {
    const user = await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1 FOR UPDATE", [
      email.data,
    ]);
    const userId = user.rows[0]?.id;
    if (!userId) return null;
    await db.query(
      "UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [userId],
    );
    const fresh = freshToken();
    await db.query(
      "INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [newId(), userId, tokenHash(fresh)],
    );
    return fresh;
  });
  // Unknown addresses get no mail, and the screen says the same thing either way.
  if (token)
    await sendMail(
      email.data,
      "GhostManual 비밀번호 재설정",
      `비밀번호를 다시 정하려면 1시간 안에 아래 링크를 여세요.\n\n${process.env["APP_ORIGIN"]}/reset-password#${token}\n\n요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 바뀌지 않습니다.`,
    );
}
export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  if (!PasswordSchema.safeParse(password).success)
    throw new AppError("invalid_input", 422, "비밀번호는 8자 이상 128자 이하로 입력하세요.");
  if (!tokenPattern.test(token)) throw invalidReset();
  const passwordHash = await hashPassword(password);
  await transaction(async (db) => {
    const found = await db.query<{ id: string; user_id: string }>(
      "SELECT id,user_id FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
      [tokenHash(token)],
    );
    const row = found.rows[0];
    if (!row) throw invalidReset();
    await db.query(
      "UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [row.user_id],
    );
    // The link proves mailbox ownership, so it also completes email verification.
    await db.query(
      "UPDATE users SET password_hash=$2,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
      [row.user_id, passwordHash],
    );
    await db.query(
      "UPDATE email_verifications SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [row.user_id],
    );
    await db.query("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
  });
}
export async function agreeTerms(ctx: SessionContext): Promise<void> {
  await transaction(async (db) => {
    await assertSession(db, ctx, true);
    await db.query(
      "UPDATE users SET terms_agreed_at=COALESCE(terms_agreed_at,now()) WHERE id=(SELECT user_id FROM sessions WHERE id=$1)",
      [ctx.sessionId],
    );
  });
}
export async function termsPending(db: DbClient, userId: string): Promise<boolean> {
  const result = await db.query<{ pending: boolean }>(
    "SELECT terms_agreed_at IS NULL AS pending FROM users WHERE id=$1",
    [userId],
  );
  return result.rows[0]?.pending ?? true;
}
