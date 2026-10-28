import { afterAll, beforeAll, expect, it } from "vitest";
import { login, signup, verifyEmail } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { finishGoogle, type GoogleProfile, startGoogle } from "../../src/lib/google.ts";
import { requireSession } from "../../src/lib/session.ts";
import { setupFileMail, uniqueEmail, verificationToken } from "./mail-helper.ts";

let mail = "";
beforeAll(() => {
  mail = setupFileMail();
  process.env["GOOGLE_CLIENT_ID"] = "test-client.apps.googleusercontent.com";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-secret";
});
afterAll(async () => {
  await pool.end();
});
const password = "correct horse 9";
function profile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    sub: `google-${crypto.randomUUID()}`,
    email: uniqueEmail(),
    emailVerified: true,
    name: "구글 사용자",
    ...overrides,
  };
}
async function stateFrom(nextPath = "/manuals") {
  const url = new URL(await startGoogle(nextPath));
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).toBe("openid email profile");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "http://localhost:3200/api/auth/google/callback",
  );
  return url.searchParams.get("state") ?? "";
}
const as = (p: GoogleProfile) => async () => p;

it("rejects unknown or reused state", async () => {
  await expect(finishGoogle("unknown-state", "code", as(profile()))).rejects.toMatchObject({
    httpStatus: 400,
  });
  const state = await stateFrom();
  await finishGoogle(state, "code", as(profile()));
  await expect(finishGoogle(state, "code", as(profile()))).rejects.toMatchObject({
    httpStatus: 400,
  });
});
it("creates a verified account and returns to the next path", async () => {
  const p = profile();
  const result = await finishGoogle(await stateFrom("/ask"), "code", as(p));
  expect(result.nextPath).toBe("/ask");
  expect((await requireSession(result.token)).role).toBe("owner");
  const user = await pool.query(
    "SELECT google_sub,password_hash,email_verified_at IS NOT NULL AS verified FROM users WHERE email=$1",
    [p.email],
  );
  expect(user.rows[0]).toEqual({ google_sub: p.sub, password_hash: null, verified: true });
});
it("links to a verified email account", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "이메일", password });
  const first = await requireSession((await verifyEmail(verificationToken(mail, email))).token);
  const result = await finishGoogle(await stateFrom(), "code", as(profile({ email })));
  expect((await requireSession(result.token)).workspaceId).toBe(first.workspaceId);
  expect((await login(email, password)).token).toBeTruthy();
});
it("takes over an unverified email account and clears its password", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "선점", password });
  const p = profile({ email });
  await finishGoogle(await stateFrom(), "code", as(p));
  const user = await pool.query(
    "SELECT google_sub,password_hash,email_verified_at IS NOT NULL AS verified FROM users WHERE email=$1",
    [email],
  );
  expect(user.rows[0]).toEqual({ google_sub: p.sub, password_hash: null, verified: true });
  await expect(login(email, password)).rejects.toMatchObject({ httpStatus: 401 });
});
it("rejects unverified google email", async () => {
  await expect(
    finishGoogle(await stateFrom(), "code", as(profile({ emailVerified: false }))),
  ).rejects.toMatchObject({ httpStatus: 400 });
});
it("only keeps same-site next paths", async () => {
  const result = await finishGoogle(await stateFrom("//evil.example"), "code", as(profile()));
  expect(result.nextPath).toBe("/manuals");
});
it("callback refuses a state that this browser did not start", async () => {
  const { GET: start } = await import("../../src/app/api/auth/google/route.ts");
  const { GET: callback } = await import("../../src/app/api/auth/google/callback/route.ts");
  process.env["IP_HASH_SECRET"] = "test-only-rate-secret-00000000000000000000";
  const started = await start(new Request("http://localhost:3200/api/auth/google?next=/ask"));
  const cookie = started.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/^gm_oauth=[\w-]{43};.*HttpOnly/);
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const url = `http://localhost:3200/api/auth/google/callback?state=${state}&code=attacker`;
  const foreign = await callback(new Request(url));
  expect(foreign.headers.get("location")).toBe("http://localhost:3200/login?error=google_failed");
  expect(foreign.headers.get("set-cookie") ?? "").not.toContain("gm_owner=");
});
