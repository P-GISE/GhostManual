import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { finishOperation, reserveAiAttempt } from "../../src/lib/operations.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { newId } from "../../src/lib/types.ts";

beforeEach(() => vi.stubEnv("AI_DAILY_LIMIT", "100000"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => pool.end());
it("reuses an operation and rejects changed payload", async () => {
  const ctx = await requireSession((await createWorkspace()).token),
    key = newId();
  const lease = await reserveAiAttempt(ctx, { kind: "generate", key, payloadHash: "first" });
  expect((await reserveAiAttempt(ctx, { kind: "generate", key, payloadHash: "first" })).id).toBe(
    lease.id,
  );
  await expect(
    reserveAiAttempt(ctx, { kind: "generate", key, payloadHash: "changed" }),
  ).rejects.toMatchObject({ httpStatus: 409 });
  await finishOperation(lease.id, { result: { ok: true } });
  expect(
    (await reserveAiAttempt(ctx, { kind: "generate", key, payloadHash: "first" })).status,
  ).toBe("complete");
});
it("reserves at most two concurrent provider attempts", async () => {
  const ctx = await requireSession((await createWorkspace()).token);
  const results = await Promise.allSettled(
    [1, 2, 3].map((n) =>
      reserveAiAttempt(ctx, { kind: "question", key: newId(), payloadHash: String(n) }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  for (const result of results)
    if (result.status === "fulfilled")
      await finishOperation(result.value.id, { errorCode: "timeout" });
});
it("counts failures toward five daily workspace generations", async () => {
  const ctx = await requireSession((await createWorkspace()).token);
  for (let n = 0; n < 5; n++) {
    const lease = await reserveAiAttempt(ctx, {
      kind: "generate",
      key: newId(),
      payloadHash: String(n),
    });
    await finishOperation(lease.id, { errorCode: "timeout" });
  }
  await expect(
    reserveAiAttempt(ctx, { kind: "generate", key: newId(), payloadHash: "sixth" }),
  ).rejects.toMatchObject({ httpStatus: 429 });
});

it("shares the twenty-question ceiling across sessions of one workspace", async () => {
  const { freshToken, tokenHash } = await import("../../src/lib/session.ts");
  const ctx = await requireSession((await createWorkspace()).token);
  for (let n = 0; n < 20; n++) {
    const lease = await reserveAiAttempt(ctx, {
      kind: "question",
      key: newId(),
      payloadHash: String(n),
    });
    await finishOperation(lease.id, { errorCode: "provider_failed" });
  }
  const token = freshToken();
  await pool.query(
    "INSERT INTO sessions(id,workspace_id,token_hash,role,expires_at) VALUES($1,$2,$3,'owner',$4)",
    [newId(), ctx.workspaceId, tokenHash(token), ctx.expiresAt],
  );
  const second = await requireSession(token);
  expect(second.sessionId).not.toBe(ctx.sessionId);
  await expect(
    reserveAiAttempt(second, { kind: "question", key: newId(), payloadHash: "twenty-first" }),
  ).rejects.toMatchObject({ code: "daily_limit", httpStatus: 429 });
});

it("keeps the global hundred-attempt ceiling after workspace deletion", async () => {
  const { z } = await import("zod");
  const { deleteWorkspace } = await import("../../src/lib/retention.ts");
  if (!new URL(process.env["DATABASE_URL"] ?? "").pathname.endsWith("_test"))
    throw new Error("Quota isolation requires a dedicated test database");
  const before = await pool.query<Record<string, unknown>>(
    "SELECT attempts FROM usage_counters WHERE scope='global' AND kind='all' AND day=(now() AT TIME ZONE 'UTC')::date",
  );
  const previous = before.rows[0] ? z.number().parse(before.rows[0]["attempts"]) : null;
  const savedLimit = process.env["AI_DAILY_LIMIT"];
  process.env["AI_DAILY_LIMIT"] = "100";
  try {
    await pool.query(
      "INSERT INTO usage_counters(day,scope,kind,attempts) VALUES((now() AT TIME ZONE 'UTC')::date,'global','all',99) ON CONFLICT(day,scope,kind) DO UPDATE SET attempts=99",
    );
    const ctx = await requireSession((await createWorkspace()).token);
    const lease = await reserveAiAttempt(ctx, {
      kind: "question",
      key: newId(),
      payloadHash: "hundredth",
    });
    await finishOperation(lease.id, { errorCode: "provider_failed" });
    await deleteWorkspace(ctx);
    const fresh = await requireSession((await createWorkspace()).token);
    await expect(
      reserveAiAttempt(fresh, { kind: "question", key: newId(), payloadHash: "hundred-first" }),
    ).rejects.toMatchObject({ code: "daily_limit", httpStatus: 429 });
    const retained = await pool.query<{ attempts: number }>(
      "SELECT attempts FROM usage_counters WHERE scope='global' AND kind='all' AND day=(now() AT TIME ZONE 'UTC')::date",
    );
    expect(retained.rows[0]?.attempts).toBe(100);
  } finally {
    if (savedLimit === undefined) delete process.env["AI_DAILY_LIMIT"];
    else process.env["AI_DAILY_LIMIT"] = savedLimit;
    if (previous === null)
      await pool.query(
        "DELETE FROM usage_counters WHERE scope='global' AND kind='all' AND day=(now() AT TIME ZONE 'UTC')::date",
      );
    else
      await pool.query(
        "UPDATE usage_counters SET attempts=$1 WHERE scope='global' AND kind='all' AND day=(now() AT TIME ZONE 'UTC')::date",
        [previous],
      );
  }
});

it("starts a new UTC day's workspace allowance independently of yesterday", async () => {
  const ctx = await requireSession((await createWorkspace()).token);
  await pool.query(
    "INSERT INTO usage_counters(day,scope,kind,attempts) VALUES((now() AT TIME ZONE 'UTC')::date-1,$1,'generate',5)",
    [ctx.workspaceId],
  );
  const lease = await reserveAiAttempt(ctx, {
    kind: "generate",
    key: newId(),
    payloadHash: "new-day",
  });
  expect(lease.isNew).toBe(true);
  await finishOperation(lease.id, { errorCode: "fixture" });
  const usage = await pool.query<{ attempts: number }>(
    "SELECT attempts FROM usage_counters WHERE scope=$1 AND kind='generate' AND day=(now() AT TIME ZONE 'UTC')::date",
    [ctx.workspaceId],
  );
  expect(usage.rows[0]?.attempts).toBe(1);
});
