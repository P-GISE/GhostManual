import { createHmac } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";

const limits = { workspace: 10, ai: 30, login: 20, signup: 10, resend: 5 } as const;
export async function limitRequest(request: Request, kind: keyof typeof limits) {
  const secret = process.env["IP_HASH_SECRET"];
  if (!secret || secret.length < 32)
    throw new AppError("configuration", 503, "서비스 설정을 확인하고 있습니다.");
  const raw =
    process.env["TRUST_CLOUDFLARE"] === "true"
      ? (request.headers.get("cf-connecting-ip") ?? "unknown")
      : "local";
  const hour = new Date().toISOString().slice(0, 13);
  const key = createHmac("sha256", secret)
    .update(raw + hour + kind)
    .digest("hex");
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(782403)");
    const result = await db.query<Record<string, unknown>>(
      "INSERT INTO rate_counters(key,attempts,expires_at) VALUES($1,1,now()+interval '24 hours') ON CONFLICT(key) DO UPDATE SET attempts=rate_counters.attempts+1 RETURNING attempts",
      [key],
    );
    if (z.number().parse(result.rows[0]?.["attempts"]) > limits[kind])
      throw new AppError("rate_limit", 429, "요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
  });
}
