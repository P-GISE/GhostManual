import { afterAll, beforeAll, expect, it } from "vitest";
import { currentUser } from "../../src/lib/accounts.ts";
import {
  adminEvents,
  aiUsage,
  listUsers,
  updateUser,
  workspaceAiAllowed,
} from "../../src/lib/admin.ts";
import { pool } from "../../src/lib/db.ts";
import { registerDocument } from "../../src/lib/document-sources.ts";
import { assertFileQuota } from "../../src/lib/file-sources.ts";
import { reserveAiAttempt, reserveChangeAi } from "../../src/lib/operations.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import type { SessionContext } from "../../src/lib/types.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
afterAll(async () => {
  delete process.env["ADMIN_EMAILS"];
  await pool.end();
});
async function userOf(ctx: SessionContext) {
  const row = await pool.query<{ id: string; email: string }>(
    "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1",
    [ctx.sessionId],
  );
  const user = row.rows[0];
  if (!user) throw new Error("no user");
  return user;
}
async function envAdmin() {
  const admin = await signedInUser(mail);
  process.env["ADMIN_EMAILS"] =
    ` ${(await userOf(admin.ctx)).email.toUpperCase()} , other@example.com`;
  return admin.ctx;
}

it("refuses non-admin accounts and reader-style guest sessions", async () => {
  delete process.env["ADMIN_EMAILS"];
  const { ctx } = await signedInUser(mail);
  await expect(listUsers(ctx)).rejects.toMatchObject({ httpStatus: 403 });
  await expect(aiUsage(ctx, 14)).rejects.toMatchObject({ httpStatus: 403 });
  await expect(adminEvents(ctx, 10)).rejects.toMatchObject({ httpStatus: 403 });
  const guest = await requireSession((await createWorkspace()).token);
  await expect(listUsers(guest)).rejects.toMatchObject({ httpStatus: 403 });
  expect((await currentUser(ctx)).admin).toBe(false);
});

it("treats ADMIN_EMAILS as permanent admins and lists users without document content", async () => {
  const admin = await envAdmin();
  expect((await currentUser(admin)).admin).toBe(true);
  const users = await listUsers(admin);
  const me = users.find((u) => u.adminSource === "env");
  expect(me).toMatchObject({ self: true });
  expect(Object.keys(users[0] ?? {})).not.toContain("title");
  const self = await userOf(admin);
  await expect(updateUser(admin, self.id, { admin: false })).rejects.toMatchObject({
    httpStatus: 400,
  });
});

it("promotes, limits and blocks AI with a change log", async () => {
  const admin = await envAdmin();
  const target = await signedInUser(mail);
  const t = await userOf(target.ctx);

  const promoted = await updateUser(admin, t.id, { admin: true });
  expect(promoted).toMatchObject({ admin: true, adminSource: "db", self: false });
  expect((await listUsers(target.ctx)).find((u) => u.id === t.id)).toMatchObject({
    self: true,
    adminSource: "db",
  });
  expect(await listUsers(target.ctx)).not.toHaveLength(0);
  // A db admin cannot demote itself, but another admin can.
  await expect(updateUser(target.ctx, t.id, { admin: false })).rejects.toMatchObject({
    httpStatus: 400,
  });
  expect((await updateUser(admin, t.id, { admin: false })).admin).toBe(false);

  const limited = await updateUser(admin, t.id, { storageLimitBytes: 2097152 });
  expect(limited.usage.limitBytes).toBe(2097152);
  expect((await currentUser(target.ctx)).usage.limitBytes).toBe(2097152);
  await expect(updateUser(admin, t.id, { storageLimitBytes: 10 })).rejects.toMatchObject({
    httpStatus: 422,
  });
  expect(() => assertFileQuota(0, 2097153, 2097152)).toThrow(/2 MB/);

  expect((await updateUser(admin, t.id, { aiAllowed: false })).aiAllowed).toBe(false);
  expect(await workspaceAiAllowed(target.ctx.workspaceId)).toBe(false);
  await expect(
    reserveAiAttempt(target.ctx, { kind: "generate", key: "blocked-key-1", payloadHash: "x" }),
  ).rejects.toMatchObject({ code: "ai_blocked", httpStatus: 403 });
  expect(await reserveChangeAi(target.ctx)).toBe(false);

  const events = await adminEvents(admin, 50);
  const mine = events.filter((e) => e.targetName === "사용자").map((e) => e.field);
  expect(mine).toEqual(expect.arrayContaining(["admin", "storageLimitBytes", "aiAllowed"]));
  expect(events[0]).toMatchObject({ field: "aiAllowed", from: true, to: false });
});

it("reports a zero-filled daily AI series within bounds", async () => {
  const admin = await envAdmin();
  const usage = await aiUsage(admin, 14);
  expect(usage.days).toHaveLength(14);
  expect(usage.days.every((d) => typeof d.total === "number")).toBe(true);
  await expect(aiUsage(admin, 0)).rejects.toThrow();
  await expect(aiUsage(admin, 61)).rejects.toThrow();
});

it("serializes cross-demotion before rechecking administrator authority", async () => {
  const bootstrap = await envAdmin();
  const a = await signedInUser(mail),
    b = await signedInUser(mail);
  const aid = (await userOf(a.ctx)).id,
    bid = (await userOf(b.ctx)).id;
  await updateUser(bootstrap, aid, { admin: true });
  await updateUser(bootstrap, bid, { admin: true });
  delete process.env["ADMIN_EMAILS"];
  const blocker = await pool.connect();
  let calls: PromiseSettledResult<unknown>[] = [];
  await blocker.query("BEGIN");
  try {
    await blocker.query("SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [
      [aid, bid],
    ]);
    const pending = Promise.allSettled([
      updateUser(a.ctx, bid, { admin: false }),
      updateUser(b.ctx, aid, { admin: false }),
    ]);
    try {
      let waiting = false;
      for (let n = 0; n < 200; n++) {
        const row = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query LIKE 'SELECT email,is_admin,%FOR UPDATE' OR query='SELECT pg_advisory_xact_lock(782403)')",
        );
        if (row.rows[0].n >= 2) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      await blocker.query("COMMIT");
      calls = await pending;
    }
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  expect(calls.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(calls.find((r) => r.status === "rejected")).toMatchObject({ reason: { httpStatus: 403 } });
  const remaining = await pool.query(
    "SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND is_admin",
    [[aid, bid]],
  );
  expect(remaining.rows[0].n).toBe(1);
});

it("enforces account quotas on new documents and revisions, including increases", async () => {
  const admin = await envAdmin(),
    target = await signedInUser(mail);
  const uid = (await userOf(target.ctx)).id;
  const small = new TextEncoder().encode("name,value\nA,1");
  const large = new TextEncoder().encode("name,value\nA," + "x".repeat(1048576));
  try {
    const first = await registerDocument(target.ctx, {
      title: "Quota",
      fileName: "small.csv",
      bytes: small,
    });
    await updateUser(admin, uid, { storageLimitBytes: 1048576 });
    await expect(
      registerDocument(target.ctx, { title: "Too large", fileName: "large.csv", bytes: large }),
    ).rejects.toMatchObject({ code: "storage_quota" });
    await expect(
      registerDocument(
        target.ctx,
        { fileName: "next.csv", bytes: large, expectedRevision: 1 },
        first.id,
      ),
    ).rejects.toMatchObject({ code: "storage_quota" });
    expect(
      (await pool.query("SELECT revision FROM sources WHERE id=$1", [first.id])).rows[0].revision,
    ).toBe(1);
    await updateUser(admin, uid, { storageLimitBytes: 2097152 });
    expect(
      await registerDocument(target.ctx, { title: "Allowed", fileName: "large.csv", bytes: large }),
    ).toMatchObject({ usage: { limitBytes: 2097152 } });
  } finally {
    await pool.query("DELETE FROM workspaces WHERE id=$1", [target.ctx.workspaceId]);
  }
});
