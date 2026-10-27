import { afterAll, beforeAll, expect, it } from "vitest";
import { signup, verifyEmail } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { limitRequest } from "../../src/lib/rate-limit.ts";
import { requireSession, tokenHash } from "../../src/lib/session.ts";
import { mailsTo, uniqueEmail, useFileMail, verificationToken } from "./mail-helper.ts";

let mail = "";
beforeAll(() => {
  mail = useFileMail();
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
it("signup does not reveal verified accounts", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "원래", password });
  await verifyEmail(verificationToken(mail, email));
  const before = await pool.query("SELECT password_hash FROM users WHERE email=$1", [email]);
  await expect(
    signup({ email: email.toUpperCase(), name: "다른", password: "other password 1" }),
  ).resolves.toBeUndefined();
  expect(mailsTo(mail, email)).toHaveLength(1);
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
