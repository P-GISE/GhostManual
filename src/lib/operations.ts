import { createHash } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertSession } from "./session.ts";
import { newId, type SessionContext } from "./types.ts";

const operationSchema = z.object({
  id: z.uuid(),
  status: z.enum(["processing", "complete", "failed"]),
  result: z.unknown(),
  payload_hash: z.string(),
  error_code: z.string().nullable(),
});
export type Operation = z.infer<typeof operationSchema> & { readonly isNew: boolean };
export function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function reserveAiAttempt(
  ctx: SessionContext,
  input: { kind: "generate" | "question"; key: string; payloadHash: string },
): Promise<Operation> {
  z.string().min(8).max(128).parse(input.key);
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(782402)");
    await assertSession(db, ctx, input.kind === "generate");
    await db.query(
      "UPDATE operation_requests SET status='failed',error_code='interrupted' WHERE status='processing' AND lease_until<=now()",
    );
    const existing = await db.query<Record<string, unknown>>(
      "SELECT * FROM operation_requests WHERE session_id=$1 AND key=$2",
      [ctx.sessionId, input.key],
    );
    if (existing.rows[0]) {
      const previous = operationSchema.parse(existing.rows[0]);
      if (previous.payload_hash !== input.payloadHash)
        throw new AppError(
          "idempotency_conflict",
          409,
          "같은 요청 키에 다른 내용을 사용할 수 없습니다.",
        );
      return { ...previous, isNew: false };
    }
    const active = await db.query<Record<string, unknown>>(
      "SELECT count(*)::int AS count FROM operation_requests WHERE status='processing' AND lease_until>now()",
    );
    if (z.number().parse(active.rows[0]?.["count"]) >= 2)
      throw new AppError(
        "busy",
        429,
        "다른 AI 작업이 진행 중입니다. 잠시 후 다시 시도하세요.",
        true,
      );
    const day = "(now() AT TIME ZONE 'UTC')::date";
    const scopes = [
      { scope: "global", kind: "all", max: Number(process.env["AI_DAILY_LIMIT"] ?? 100) },
      { scope: ctx.workspaceId, kind: input.kind, max: input.kind === "generate" ? 5 : 20 },
    ];
    for (const quota of scopes) {
      const count = await db.query<Record<string, unknown>>(
        `SELECT attempts FROM usage_counters WHERE day=${day} AND scope=$1 AND kind=$2`,
        [quota.scope, quota.kind],
      );
      if (count.rows[0] && z.number().parse(count.rows[0]["attempts"]) >= quota.max)
        throw new AppError(
          "daily_limit",
          429,
          "오늘의 AI 사용 한도에 도달했습니다. UTC 자정 이후 다시 이용하세요.",
        );
    }
    for (const quota of scopes)
      await db.query(
        `INSERT INTO usage_counters(day,scope,kind,attempts) VALUES(${day},$1,$2,1) ON CONFLICT(day,scope,kind) DO UPDATE SET attempts=usage_counters.attempts+1`,
        [quota.scope, quota.kind],
      );
    const result = await db.query<Record<string, unknown>>(
      "INSERT INTO operation_requests(id,workspace_id,session_id,key,payload_hash,kind,status,lease_until) VALUES($1,$2,$3,$4,$5,$6,'processing',now()+interval '60 seconds') RETURNING *",
      [newId(), ctx.workspaceId, ctx.sessionId, input.key, input.payloadHash, input.kind],
    );
    return { ...operationSchema.parse(result.rows[0]), isNew: true };
  });
}
export async function finishOperation(
  id: string,
  outcome: { result?: unknown; errorCode?: string },
) {
  await transaction(async (db) => {
    await db.query(
      "UPDATE operation_requests SET status=$2,result=$3,error_code=$4 WHERE id=$1 AND status='processing'",
      [
        id,
        outcome.errorCode ? "failed" : "complete",
        outcome.result ? JSON.stringify(outcome.result) : null,
        outcome.errorCode ?? null,
      ],
    );
  });
}
// Counts one change-question AI call against the global and per-workspace daily limits; false when used up.
export async function reserveChangeAi(ctx: SessionContext): Promise<boolean> {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(782402)");
    await assertSession(db, ctx, true);
    const day = "(now() AT TIME ZONE 'UTC')::date";
    const scopes = [
      { scope: "global", kind: "all", max: Number(process.env["AI_DAILY_LIMIT"] ?? 100) },
      { scope: ctx.workspaceId, kind: "change", max: 30 },
    ];
    for (const quota of scopes) {
      const count = await db.query<{ attempts: number }>(
        `SELECT attempts FROM usage_counters WHERE day=${day} AND scope=$1 AND kind=$2`,
        [quota.scope, quota.kind],
      );
      if ((count.rows[0]?.attempts ?? 0) >= quota.max) return false;
    }
    for (const quota of scopes)
      await db.query(
        `INSERT INTO usage_counters(day,scope,kind,attempts) VALUES(${day},$1,$2,1) ON CONFLICT(day,scope,kind) DO UPDATE SET attempts=usage_counters.attempts+1`,
        [quota.scope, quota.kind],
      );
    return true;
  });
}
