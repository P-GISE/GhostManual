import { afterAll, beforeAll, expect, it } from "vitest";
import { GET as sessionRoute } from "../../src/app/api/session/route.ts";
import { agreeTerms, currentUser, signup, verifyEmail } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { finishGoogle, type GoogleProfile, startGoogle } from "../../src/lib/google.ts";
import { listManuals } from "../../src/lib/manuals.ts";
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
async function googleSignIn(overrides: Partial<GoogleProfile> = {}) {
  const state = new URL(await startGoogle("/ask")).searchParams.get("state") ?? "";
  return finishGoogle(state, "code", async () => ({
    sub: `google-${crypto.randomUUID()}`,
    email: uniqueEmail(),
    emailVerified: true,
    name: "구글",
    ...overrides,
  }));
}
async function agreedAt(email: string) {
  const row = await pool.query<{ agreed: boolean }>(
    "SELECT terms_agreed_at IS NOT NULL AS agreed FROM users WHERE email=$1",
    [email],
  );
  return row.rows[0]?.agreed;
}

it("email signup requires agreement and records it", async () => {
  const email = uniqueEmail();
  // @ts-expect-error consent is deliberately missing
  await expect(signup({ email, name: "미동의", password })).rejects.toThrow();
  await signup({ email, name: "동의", password, agreed: true });
  expect(await agreedAt(email)).toBe(true);
});
it("a first Google sign-in must agree before using the service", async () => {
  const email = uniqueEmail();
  const result = await googleSignIn({ email });
  expect(result.termsRequired).toBe(true);
  expect(await agreedAt(email)).toBe(false);
  await expect(requireSession(result.token)).rejects.toMatchObject({
    httpStatus: 403,
    code: "terms_required",
  });
  const pending = await requireSession(result.token, { allowPendingTerms: true });
  expect((await currentUser(pending)).email).toBe(email);
  const origin = "http://localhost:3200";
  const session = await sessionRoute(
    new Request(`${origin}/api/session`, { headers: { cookie: `gm_owner=${result.token}` } }),
  );
  expect(await session.json()).toMatchObject({ role: "owner", termsRequired: true });
  await agreeTerms(pending);
  expect(await agreedAt(email)).toBe(true);
  expect(await listManuals(await requireSession(result.token))).toEqual([]);
});
it("Google sign-in to an agreed account goes straight in", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "기존", password, agreed: true });
  await verifyEmail(verificationToken(mail, email));
  const result = await googleSignIn({ email });
  expect(result.termsRequired).toBe(false);
  expect((await requireSession(result.token)).role).toBe("owner");
});
it("taking over an unverified email account asks for agreement again", async () => {
  const email = uniqueEmail();
  await signup({ email, name: "선점", password, agreed: true });
  const result = await googleSignIn({ email });
  expect(result.termsRequired).toBe(true);
  expect(await agreedAt(email)).toBe(false);
});
