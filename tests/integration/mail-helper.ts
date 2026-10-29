import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function setupFileMail(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-mail-"));
  process.env["MAIL_DRIVER"] = "file";
  process.env["MAIL_DIR"] = dir;
  process.env["APP_ORIGIN"] = "http://localhost:3200";
  return dir;
}
export function mailsTo(dir: string, email: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(`-${email}.txt`))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"));
}
export function verificationToken(dir: string, email: string): string {
  const token = mailsTo(dir, email)
    .at(-1)
    ?.match(/\/api\/auth\/verify\?token=([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error(`No verification mail for ${email}`);
  return token;
}
export function uniqueEmail(): string {
  return `user-${crypto.randomUUID()}@example.com`;
}
export async function signedInUser(dir: string) {
  const { signup, verifyEmail } = await import("../../src/lib/accounts.ts");
  const { requireSession } = await import("../../src/lib/session.ts");
  const email = uniqueEmail();
  await signup({ email, name: "사용자", password: "correct horse 9", agreed: true });
  const session = await verifyEmail(verificationToken(dir, email));
  return { ctx: await requireSession(session.token), token: session.token };
}
// Turns link sharing on and opens it as a fresh signed-in account.
export async function shareWithNewReader(
  owner: import("../../src/lib/types.ts").SessionContext,
  manualId: string,
) {
  const dir =
    process.env["MAIL_DRIVER"] === "file" && process.env["MAIL_DIR"]
      ? process.env["MAIL_DIR"]
      : setupFileMail();
  const { exchangeShare, setSharing } = await import("../../src/lib/shares.ts");
  const sharing = await setSharing(owner, manualId, "link");
  if (sharing.mode !== "link") throw new Error("expected link sharing");
  const viewer = await signedInUser(dir);
  return exchangeShare(sharing.url.slice(sharing.url.indexOf("#") + 1), viewer.ctx);
}
