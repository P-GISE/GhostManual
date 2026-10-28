import { afterAll, beforeAll, expect, it } from "vitest";
import { deleteAccount, login, logout, signup, verifyEmail } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { listManuals } from "../../src/lib/manuals.ts";
import { limitRequest } from "../../src/lib/rate-limit.ts";
import { requireSession, tokenHash } from "../../src/lib/session.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";
import { exampleSource } from "../fixtures/manual-example.ts";
import { mailsTo, setupFileMail, uniqueEmail, verificationToken } from "./mail-helper.ts";

let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
afterAll(async () => {
  await pool.end();
});
const password = "correct horse 9";
it("schema has account tables", async () => {
  const tables = await pool.query<Record<string, unknown>>(
    "SELECT to_regclass('users') AS users, to_regclass('email_verifications') AS verifications, to_regclass('oauth_states') AS states",
  );
  expect(Object.values(tables.rows[0] ?? {})).not.toContain(null);
  const columns = await pool.query<{ name: string }>(
    "SELECT table_name||'.'||column_name AS name FROM information_schema.columns WHERE (table_name,column_name) IN (('workspaces','user_id'),('sessions','user_id'),('shares','link_token'))",
  );
  expect(columns.rows.map((r) => r.name).sort()).toEqual([
    "sessions.user_id",
    "shares.link_token",
    "workspaces.user_id",
  ]);
});
it("signup creates unverified user and mails a link", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "박효민", password });
  const user = await pool.query<Record<string, unknown>>(
    "SELECT id,password_hash,email_verified_at FROM users WHERE email=$1",
    [email],
  );
  expect(user.rows).toHaveLength(1);
  expect(user.rows[0]?.["email_verified_at"]).toBeNull();
  expect(user.rows[0]?.["password_hash"]).not.toContain(password);
  const token = verificationToken(mail, email);
  const stored = await pool.query<{ token_hash: string }>(
    "SELECT token_hash FROM email_verifications WHERE user_id=$1",
    [user.rows[0]?.["id"]],
  );
  expect(stored.rows.map((r) => r.token_hash)).toEqual([tokenHash(token)]);
});
it("verify opens an owner session once", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "인증", password });
  const token = verificationToken(mail, email);
  const session = await verifyEmail(token);
  const ctx = await requireSession(session.token);
  expect(ctx.role).toBe("owner");
  const workspace = await pool.query<{ forever: boolean }>(
    "SELECT expires_at='infinity'::timestamptz AS forever FROM workspaces WHERE id=$1",
    [ctx.workspaceId],
  );
  expect(workspace.rows[0]?.forever).toBe(true);
  await expect(verifyEmail(token)).rejects.toMatchObject({ httpStatus: 400 });
});
it("expired verification is rejected", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "만료", password });
  const token = verificationToken(mail, email);
  await pool.query(
    "UPDATE email_verifications SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [tokenHash(token)],
  );
  await expect(verifyEmail(token)).rejects.toMatchObject({ httpStatus: 400 });
});
it("signup does not reveal verified accounts but tells the owner by mail", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "원래", password });
  await verifyEmail(verificationToken(mail, email));
  const before = await pool.query("SELECT password_hash FROM users WHERE email=$1", [email]);
  await expect(
    signup({ email: email.toUpperCase(), name: "다른", password: "other password 1" }),
  ).resolves.toBeUndefined();
  const mails = mailsTo(mail, email);
  expect(mails).toHaveLength(2);
  expect(mails[1]).toContain("이미 가입된 계정");
  expect(mails[1]).toContain("http://localhost:3200/login");
  expect(mails[1]).not.toContain("/api/auth/verify");
  const after = await pool.query("SELECT password_hash FROM users WHERE email=$1", [email]);
  expect(after.rows).toEqual(before.rows);
});
it("limits verification resends per IP and hour", async () => {
  process.env["IP_HASH_SECRET"] = "test-only-rate-secret-00000000000000000000";
  process.env["TRUST_CLOUDFLARE"] = "true";
  const request = () =>
    new Request("http://localhost/api/auth/verify/resend", {
      headers: { "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 200)}` },
    });
  const same = request();
  for (let i = 0; i < 5; i++) await limitRequest(same, "resend");
  await expect(limitRequest(same, "resend")).rejects.toMatchObject({ httpStatus: 429 });
});
async function verifiedUser(name = "사용자") {
  const email = uniqueEmail();
  await signup({ email, name, password });
  await verifyEmail(verificationToken(mail, email));
  return email;
}
it("login requires verified email and correct password", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "로그인", password });
  await expect(login(email, password)).rejects.toMatchObject({ httpStatus: 403 });
  await verifyEmail(verificationToken(mail, email));
  const wrong = await login(email, "wrong password 1").catch((e: unknown) => e);
  const missing = await login(uniqueEmail(), password).catch((e: unknown) => e);
  expect(wrong).toMatchObject({ httpStatus: 401 });
  expect(missing).toMatchObject({ httpStatus: 401, message: (wrong as Error).message });
  const session = await login(` ${email.toUpperCase()} `, password);
  expect((await requireSession(session.token)).role).toBe("owner");
});
it("users cannot read each other's documents", async () => {
  const a = await requireSession((await login(await verifiedUser("A"), password)).token);
  const b = await requireSession((await login(await verifiedUser("B"), password)).token);
  expect(a.workspaceId).not.toBe(b.workspaceId);
  const source = await createSource(a, exampleSource);
  await expect(getSource(b, source.id)).rejects.toMatchObject({ httpStatus: 404 });
  expect(await listManuals(b)).toEqual([]);
});
it("logout invalidates the session", async () => {
  const session = await login(await verifiedUser(), password);
  await logout(await requireSession(session.token));
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
});
it("deleting the account removes workspace and sessions", async () => {
  const email = await verifiedUser();
  const ctx = await requireSession((await login(email, password)).token);
  await createSource(ctx, exampleSource);
  await deleteAccount(ctx);
  const left = await pool.query<{ users: number; workspaces: number; sessions: number }>(
    "SELECT (SELECT count(*)::int FROM users WHERE email=$1) AS users,(SELECT count(*)::int FROM workspaces WHERE id=$2) AS workspaces,(SELECT count(*)::int FROM sessions WHERE workspace_id=$2) AS sessions",
    [email, ctx.workspaceId],
  );
  expect(left.rows[0]).toEqual({ users: 0, workspaces: 0, sessions: 0 });
});
