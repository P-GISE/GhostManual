import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "./errors.ts";

// Single send point so the provider (Gmail SMTP today) can be swapped later.
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (process.env["MAIL_DRIVER"] === "file") {
    const dir = process.env["MAIL_DIR"];
    if (!dir) throw new AppError("configuration", 503, "메일 발송 설정을 확인하고 있습니다.");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${Date.now()}-${to}.txt`), `${subject}\n\n${text}`, "utf8");
    return;
  }
  const user = process.env["SMTP_USER"],
    pass = process.env["SMTP_APP_PASSWORD"];
  if (!user || !pass)
    throw new AppError("configuration", 503, "메일 발송 설정을 확인하고 있습니다.");
  const { createTransport } = await import("nodemailer");
  try {
    await createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    }).sendMail({
      from: `GhostManual <${user}>`,
      to,
      subject,
      text,
    });
  } catch {
    throw new AppError(
      "mail_failed",
      502,
      "메일을 보내지 못했습니다. 잠시 후 다시 시도하세요.",
      true,
    );
  }
}
