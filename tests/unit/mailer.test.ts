import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sendMail } from "../../src/lib/mailer.ts";

afterEach(() => vi.unstubAllEnvs());
it("writes mail to a file in test mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gm-mail-unit-"));
  vi.stubEnv("MAIL_DRIVER", "file");
  vi.stubEnv("MAIL_DIR", dir);
  await sendMail("a@example.com", "제목", "본문 링크");
  const [name] = readdirSync(dir);
  expect(name).toMatch(/^\d+-a@example\.com\.txt$/);
  expect(readFileSync(join(dir, name ?? ""), "utf8")).toContain("본문 링크");
});
it("refuses to send without SMTP settings", async () => {
  vi.stubEnv("MAIL_DRIVER", "smtp");
  vi.stubEnv("SMTP_USER", "");
  vi.stubEnv("SMTP_APP_PASSWORD", "");
  await expect(sendMail("a@example.com", "제목", "본문")).rejects.toMatchObject({
    httpStatus: 503,
  });
});
