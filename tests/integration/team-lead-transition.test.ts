import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolatedDatabase } from "../isolated-database.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const sql = await readFile("db/migrations/014_team_lead_enforce.sql", "utf8").catch(() => null);
const original = process.env["DATABASE_URL"];
let isolated: Awaited<ReturnType<typeof isolatedDatabase>> | undefined;
let pool: typeof import("../../src/lib/db.ts").pool | undefined;
let teams: typeof import("../../src/lib/teams.ts") | undefined;
beforeAll(async () => {
  if (!sql) return;
  isolated = await isolatedDatabase(13);
  process.env["DATABASE_URL"] = isolated.connectionString;
  pool = (await import("../../src/lib/db.ts")).pool;
  teams = await import("../../src/lib/teams.ts");
});
afterAll(async () => {
  await pool?.end();
  if (original === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = original;
  await isolated?.close();
});

it("finishes blocked compatible creates after actual 014 and rejects old writers while the real transfer API works", async () => {
  expect(sql, "actual enforcement SQL is required").not.toBeNull();
  const db = pool,
    app = teams;
  if (!sql || !db || !app) return;
  const mail = setupFileMail();
  const lead = await signedInUser(mail);
  const existing = await app.createTeam(lead.ctx, "전환 전 합성 팀");
  expect(
    (await db.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [existing.id])).rows[0]
      ?.lead_user_id,
  ).toBeNull();
  const blocker = await db.connect();
  let pending: ReturnType<typeof app.createTeam> | undefined;
  let created: Awaited<ReturnType<typeof app.createTeam>> | undefined;
  try {
    await blocker.query("BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'");
    await blocker.query("LOCK TABLE workspaces IN ACCESS EXCLUSIVE MODE");
    pending = app.createTeam(lead.ctx, "전환 대기 합성 팀");
    for (let attempt = 0; attempt < 100; attempt++) {
      await blocker.query("SELECT pg_stat_clear_snapshot()");
      const waiting = await blocker.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM workspaces WHERE id=ANY%'",
      );
      if (waiting.rowCount) break;
      if (attempt === 99) throw new Error("compatible writer did not reach the migration lock");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await blocker.query(sql);
    await blocker.query("INSERT INTO schema_migrations(name) VALUES('014_team_lead_enforce.sql')");
    await blocker.query("COMMIT");
    created = await pending;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending?.catch(() => undefined);
  }
  expect(created).toBeDefined();
  if (!created) throw new Error("compatible create did not finish");
  for (const id of [existing.id, created.id])
    expect(
      (await db.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [id])).rows[0]
        ?.lead_user_id,
    ).toBe(lead.ctx.userId);

  const oldWriter = await db.connect();
  const oldId = crypto.randomUUID();
  try {
    await oldWriter.query("BEGIN");
    await oldWriter.query(
      "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank','구버전 합성 팀','infinity')",
      [oldId],
    );
    await oldWriter.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
      [oldId, lead.ctx.userId],
    );
    await expect(oldWriter.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
    await oldWriter.query("ROLLBACK");
  } finally {
    oldWriter.release();
  }
  expect((await db.query("SELECT id FROM workspaces WHERE id=$1", [oldId])).rowCount).toBe(0);

  const admin = await signedInUser(mail),
    other = await signedInUser(mail);
  await db.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'admin')",
    [created.id, admin.ctx.userId, other.ctx.userId],
  );
  const { POST } = await import("../../src/app/api/workspaces/[id]/lead/route.ts");
  const response = await POST(
    new Request("http://localhost:3200/api/workspaces/test/lead", {
      method: "POST",
      headers: {
        origin: "http://localhost:3200",
        "content-type": "application/json",
        cookie: `gm_owner=${lead.token}`,
      },
      body: JSON.stringify({ userId: (admin.ctx.userId as string).toUpperCase() }),
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: created.id, leadUserId: admin.ctx.userId });
  await expect(
    app.removeMember(admin.ctx, created.id, admin.ctx.userId as string),
  ).rejects.toMatchObject({ code: "lead_transfer_required", httpStatus: 409 });

  const race = await app.createTeam(lead.ctx, "실제 제약 이양 경합 팀");
  await db.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'admin')",
    [race.id, admin.ctx.userId, other.ctx.userId],
  );
  const outcomes = await Promise.allSettled([
    app.transferTeamLead(lead.ctx, race.id, admin.ctx.userId as string),
    app.transferTeamLead(lead.ctx, race.id, other.ctx.userId as string),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toEqual([
    expect.objectContaining({ reason: expect.objectContaining({ httpStatus: 403 }) }),
  ]);
  expect(
    (
      await db.query(
        "SELECT m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=w.lead_user_id WHERE w.id=$1",
        [race.id],
      )
    ).rows[0]?.role,
  ).toBe("admin");
});
