import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function useFileMail(): string {
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
