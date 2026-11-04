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
  expect(me).toBeDefined();
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
  expect(promoted).toMatchObject({ admin: true, adminSource: "db" });
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
