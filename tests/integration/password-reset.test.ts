import { afterAll, beforeAll, expect, it } from "vitest";
import {
  confirmPasswordReset,
  login,
  requestPasswordReset,
  signup,
  verifyEmail,
} from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { limitRequest } from "../../src/lib/rate-limit.ts";
import { requireSession, tokenHash } from "../../src/lib/session.ts";
import { mailsTo, setupFileMail, uniqueEmail, verificationToken } from "./mail-helper.ts";

let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
afterAll(async () => {
  await pool.end();
});
const password = "correct horse 9";
const fresh = "brand new pass 7";
function resetToken(email: string) {
  const token = mailsTo(mail, email)
    .at(-1)
    ?.match(/\/reset-password#([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error("No reset mail");
  return token;
}
async function verifiedUser() {
  const email = uniqueEmail();
  await signup({ email, name: "재설정", password, agreed: true });
  const session = await verifyEmail(verificationToken(mail, email));
  return { email, session };
}

it("schema has a password reset table", async () => {
  const table = await pool.query("SELECT to_regclass('password_resets') AS t");
  expect(table.rows[0]?.["t"]).not.toBeNull();
});
it("mails a one-time reset link and stores only its hash", async () => {
  const { email } = await verifiedUser();
  await requestPasswordReset(` ${email.toUpperCase()} `);
  const token = resetToken(email);
  const stored = await pool.query<{ token_hash: string }>(
    "SELECT pr.token_hash FROM password_resets pr JOIN users u ON u.id=pr.user_id WHERE u.email=$1",
    [email],
  );
  expect(stored.rows.map((r) => r.token_hash)).toEqual([tokenHash(token)]);
});
it("does not reveal unknown emails", async () => {
  const email = uniqueEmail();
  await expect(requestPasswordReset(email)).resolves.toBeUndefined();
  expect(mailsTo(mail, email)).toHaveLength(0);
});
it("sets the new password once and signs out every session", async () => {
  const { email, session } = await verifiedUser();
  await requestPasswordReset(email);
  const token = resetToken(email);
  await confirmPasswordReset(token, fresh);
  await expect(requireSession(session.token)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(login(email, password)).rejects.toMatchObject({ httpStatus: 401 });
  expect((await login(email, fresh)).token).toBeTruthy();
  await expect(confirmPasswordReset(token, "another pass 5")).rejects.toMatchObject({
    httpStatus: 400,
  });
});
it("rejects expired links, replaced links and short passwords", async () => {
  const { email } = await verifiedUser();
  await requestPasswordReset(email);
  const first = resetToken(email);
  await requestPasswordReset(email);
  const second = resetToken(email);
  await expect(confirmPasswordReset(first, fresh)).rejects.toMatchObject({ httpStatus: 400 });
  await expect(confirmPasswordReset(second, "short")).rejects.toMatchObject({ httpStatus: 422 });
  await pool.query(
    "UPDATE password_resets SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [tokenHash(second)],
  );
  await expect(confirmPasswordReset(second, fresh)).rejects.toMatchObject({ httpStatus: 400 });
});
it("verifies an unverified account through the reset link", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "미인증", password, agreed: true });
  await requestPasswordReset(email);
  await confirmPasswordReset(resetToken(email), fresh);
  expect((await login(email, fresh)).token).toBeTruthy();
});
it("limits reset requests per IP and hour", async () => {
  process.env["IP_HASH_SECRET"] = "test-only-rate-secret-00000000000000000000";
  process.env["TRUST_CLOUDFLARE"] = "true";
  const request = new Request("http://localhost/api/auth/password-reset", {
    headers: { "cf-connecting-ip": `203.0.113.${Math.floor(Math.random() * 200)}` },
  });
  for (let i = 0; i < 5; i++) await limitRequest(request, "reset");
  await expect(limitRequest(request, "reset")).rejects.toMatchObject({ httpStatus: 429 });
});
