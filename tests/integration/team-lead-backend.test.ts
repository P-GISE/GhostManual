import { afterAll, afterEach, expect, it } from "vitest";
import { POST } from "../../src/app/api/workspaces/[id]/lead/route.ts";
import { DELETE as leaveRoute } from "../../src/app/api/workspaces/[id]/members/[userId]/route.ts";
import { deleteAccount } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { requireSession } from "../../src/lib/session.ts";
import { exchangeShare, getSharing, setSharing } from "../../src/lib/shares.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";
import * as teams from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const mail = setupFileMail();
const marker = "014_team_lead_enforce.sql";
afterEach(async () => {
  await pool.query("DELETE FROM schema_migrations WHERE name=$1", [marker]);
});
afterAll(() => pool.end());
const transfer = teams.transferTeamLead;
async function fixture(ready = true) {
  const lead = await signedInUser(mail),
    admin = await signedInUser(mail),
    member = await signedInUser(mail);
  const team = await teams.createTeam(lead.ctx, "대표 이양 합성 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [team.id, admin.ctx.userId, member.ctx.userId],
  );
  if (ready) {
    // Protocol simulation only: future 014 constraints are deliberately not installed.
    await pool.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
      team.id,
      lead.ctx.userId,
    ]);
    await pool.query("INSERT INTO schema_migrations(name) VALUES($1)", [marker]);
  }
  return { lead, admin, member, team };
}
const pointer = async (id: string) =>
  (await pool.query("SELECT lead_user_id FROM workspaces WHERE id=$1", [id])).rows[0]?.lead_user_id;

it("keeps 013 legacy roles and null pointers while reporting transfer not ready", async () => {
  const { lead, admin, member, team } = await fixture(false);
  expect(await pointer(team.id)).toBeNull();
  expect(await teams.listMembers(lead.ctx, team.id)).toMatchObject({
    leadReady: false,
    leadUserId: null,
    members: expect.arrayContaining([
      expect.objectContaining({ id: lead.ctx.userId, lead: false }),
    ]),
  });
  await expect(transfer(lead.ctx, team.id, admin.ctx.userId as string)).rejects.toMatchObject({
    code: "team_lead_not_ready",
    httpStatus: 503,
  });
  await teams.changeRole(admin.ctx, team.id, member.ctx.userId as string, "admin");
  await teams.changeRole(admin.ctx, team.id, lead.ctx.userId as string, "member");
  await teams.removeMember(lead.ctx, team.id, lead.ctx.userId as string);
  expect(await pointer(team.id)).toBeNull();
  await teams.removeMember(admin.ctx, team.id, member.ctx.userId as string);
  await teams.deleteTeam(admin.ctx, team.id, team.name);
});

it("transfers only the pointer, retaining admin roles, sessions and current admin deletion rights", async () => {
  const { lead, admin, member, team } = await fixture();
  const before = (
    await pool.query(
      "SELECT to_jsonb(m) AS row FROM workspace_members m WHERE workspace_id=$1 ORDER BY user_id",
      [team.id],
    )
  ).rows;
  const sessions = (
    await pool.query(
      "SELECT id,token_hash FROM sessions WHERE user_id=ANY($1::uuid[]) ORDER BY id",
      [[lead.ctx.userId, admin.ctx.userId]],
    )
  ).rows;
  for (const target of [lead.ctx.userId, member.ctx.userId, crypto.randomUUID()])
    await expect(transfer(lead.ctx, team.id, target as string)).rejects.toMatchObject({
      httpStatus: 422,
    });
  await expect(
    transfer(lead.ctx, team.id, (lead.ctx.userId as string).toUpperCase()),
  ).rejects.toMatchObject({
    httpStatus: 422,
  });
  expect(await pointer(team.id)).toBe(lead.ctx.userId);
  for (const actor of [admin, member])
    await expect(transfer(actor.ctx, team.id, lead.ctx.userId as string)).rejects.toMatchObject({
      httpStatus: 403,
    });
  expect(await transfer(lead.ctx, team.id, (admin.ctx.userId as string).toUpperCase())).toEqual({
    id: team.id,
    leadUserId: admin.ctx.userId,
  });
  expect(await pointer(team.id)).toBe(admin.ctx.userId);
  expect(
    (
      await pool.query(
        "SELECT to_jsonb(m) AS row FROM workspace_members m WHERE workspace_id=$1 ORDER BY user_id",
        [team.id],
      )
    ).rows,
  ).toEqual(before);
  expect(
    (
      await pool.query(
        "SELECT id,token_hash FROM sessions WHERE user_id=ANY($1::uuid[]) ORDER BY id",
        [[lead.ctx.userId, admin.ctx.userId]],
      )
    ).rows,
  ).toEqual(sessions);
  const listed = await teams.listMembers(member.ctx, team.id);
  expect(listed).toMatchObject({ leadReady: true, leadUserId: admin.ctx.userId });
  expect(listed.members.filter((m) => m["lead"])).toEqual([
    expect.objectContaining({ id: admin.ctx.userId, role: "admin", lead: true }),
  ]);
  expect(listed.members.every((m) => !("email" in m))).toBe(true);
  await teams.deleteTeam(lead.ctx, team.id, team.name);
});

it("rejects lead demotion, removal and account deletion before personal data is touched", async () => {
  const { lead, admin, team } = await fixture();
  const source = await createSource(lead.ctx, exampleSource);
  const teamCtx = await requireSession((await teams.switchWorkspace(admin.token, team.id)).token);
  const teamSource = await createSource(teamCtx, exampleSource);
  const manual = await saveDraft(teamCtx, teamSource.revisionId, exampleDraft);
  await publishManual(teamCtx, manual.id, 1, exampleDraft.unknowns);
  const link = await setSharing(teamCtx, manual.id, "link");
  if (link.mode !== "link") throw new Error("expected link share");
  const viewer = await signedInUser(mail);
  const reader = await requireSession(
    (await exchangeShare(link.url.split("#")[1] ?? "", viewer.ctx)).token,
  );
  const sharedBefore = JSON.stringify(await getSharing(teamCtx, manual.id));
  for (const action of [
    () => teams.changeRole(admin.ctx, team.id, lead.ctx.userId as string, "member"),
    () => teams.removeMember(admin.ctx, team.id, lead.ctx.userId as string),
    () => teams.removeMember(lead.ctx, team.id, lead.ctx.userId as string),
    () => deleteAccount(lead.ctx),
  ]) {
    await expect(action()).rejects.toMatchObject({
      code: "lead_transfer_required",
      httpStatus: 409,
    });
    expect((await getSource(lead.ctx, source.id)).id).toBe(source.id);
    await expect(requireSession(lead.token)).resolves.toMatchObject({ userId: lead.ctx.userId });
    expect(await pointer(team.id)).toBe(lead.ctx.userId);
    expect((await getSource(teamCtx, teamSource.id)).id).toBe(teamSource.id);
    expect((await getManual(reader, manual.id)).id).toBe(manual.id);
    expect(JSON.stringify(await getSharing(teamCtx, manual.id))).toBe(sharedBefore);
  }
  await transfer(lead.ctx, team.id, admin.ctx.userId as string);
  await deleteAccount(lead.ctx);
  expect((await pool.query("SELECT id FROM users WHERE id=$1", [lead.ctx.userId])).rowCount).toBe(
    0,
  );
  expect(await pointer(team.id)).toBe(admin.ctx.userId);
  expect((await teams.listMembers(admin.ctx, team.id)).members).toHaveLength(2);
  expect((await getSource(teamCtx, teamSource.id)).id).toBe(teamSource.id);
  expect((await getManual(reader, manual.id)).id).toBe(manual.id);
  expect(JSON.stringify(await getSharing(teamCtx, manual.id))).toBe(sharedBefore);
});

it("serializes stale-actor transfers and target demotion with no dangling lead", async () => {
  const { lead, admin, member, team } = await fixture();
  await teams.changeRole(lead.ctx, team.id, member.ctx.userId as string, "admin");
  const results = await Promise.allSettled([
    transfer(lead.ctx, team.id, admin.ctx.userId as string),
    transfer(lead.ctx, team.id, member.ctx.userId as string),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toEqual([
    expect.objectContaining({ reason: expect.objectContaining({ httpStatus: 403 }) }),
  ]);
  await pool.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [team.id, lead.ctx.userId]);
  const race = await Promise.allSettled([
    transfer(lead.ctx, team.id, admin.ctx.userId as string),
    teams.changeRole(lead.ctx, team.id, admin.ctx.userId as string, "member"),
  ]);
  expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failure = race.find((r) => r.status === "rejected");
  expect(failure).toBeDefined();
  if (failure?.status === "rejected") expect([409, 422]).toContain(failure.reason.httpStatus);
  expect(
    (
      await pool.query(
        "SELECT m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=w.lead_user_id WHERE w.id=$1",
        [team.id],
      )
    ).rows[0]?.role,
  ).toBe("admin");
});

it("rechecks readiness after an insert blocked at the future migration boundary", async () => {
  const lead = await signedInUser(mail),
    blocker = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE workspaces IN SHARE ROW EXCLUSIVE MODE");
    pending = teams.createTeam(lead.ctx, "단계 경계 합성 팀");
    for (let attempt = 0; attempt < 100; attempt++) {
      await blocker.query("SELECT pg_stat_clear_snapshot()");
      const waiters = await blocker.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO workspaces%'",
      );
      if (waiters.rowCount) break;
      if (attempt === 99) throw new Error("createTeam did not reach blocked INSERT");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await blocker.query("INSERT INTO schema_migrations(name) VALUES($1)", [marker]);
    await blocker.query("COMMIT");
    const created = (await pending) as { id: string };
    expect(await pointer(created.id)).toBe(lead.ctx.userId);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending?.catch(() => undefined);
  }
});

it("enforces transfer HTTP authentication, origin, strict input and membership", async () => {
  const { lead, admin, member, team } = await fixture();
  const outsider = await signedInUser(mail);
  const request = (
    token?: string,
    input: unknown = { userId: admin.ctx.userId },
    origin = "http://localhost:3200",
  ) =>
    new Request("http://localhost:3200/api/workspaces/test/lead", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(token ? { cookie: `gm_owner=${token}` } : {}),
      },
      body: JSON.stringify(input),
    });
  const call = (r: Request) => POST(r, { params: Promise.resolve({ id: team.id }) });
  expect((await call(request())).status).toBe(401);
  expect((await call(request(lead.token, undefined, "https://attacker.invalid"))).status).toBe(403);
  expect((await call(request(lead.token, { userId: "bad" }))).status).toBe(422);
  expect(
    (await call(request(lead.token, { userId: admin.ctx.userId, role: "admin" }))).status,
  ).toBe(422);
  expect((await call(request(outsider.token))).status).toBe(404);
  expect((await call(request(member.token))).status).toBe(403);
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [
    outsider.ctx.sessionId,
  ]);
  expect((await call(request(outsider.token))).status).toBe(401);
  const teamCtx = await requireSession((await teams.switchWorkspace(admin.token, team.id)).token);
  const source = await createSource(teamCtx, exampleSource);
  const manual = await saveDraft(teamCtx, source.revisionId, exampleDraft);
  await publishManual(teamCtx, manual.id, 1, exampleDraft.unknowns);
  const link = await setSharing(teamCtx, manual.id, "link");
  if (link.mode !== "link") throw new Error("expected link share");
  const readerAccount = await signedInUser(mail);
  const readerSession = await exchangeShare(link.url.split("#")[1] ?? "", readerAccount.ctx);
  const readerRequest = request();
  readerRequest.headers.set("cookie", "gm_reader=" + readerSession.token);
  readerRequest.headers.set("x-ghost-role", "reader");
  expect((await call(readerRequest)).status).toBe(404);
  expect(
    (await call(request(lead.token, { userId: (lead.ctx.userId as string).toUpperCase() }))).status,
  ).toBe(422);
  expect(await pointer(team.id)).toBe(lead.ctx.userId);
  const response = await call(
    request(lead.token, { userId: (admin.ctx.userId as string).toUpperCase() }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: team.id, leadUserId: admin.ctx.userId });
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("does not infer a lead when the enforcement marker exists but the team pointer is null", async () => {
  const { lead, admin, team } = await fixture(false);
  await pool.query("INSERT INTO schema_migrations(name) VALUES($1)", [marker]);
  expect(await teams.listMembers(lead.ctx, team.id)).toMatchObject({
    leadReady: false,
    leadUserId: null,
  });
  await expect(transfer(lead.ctx, team.id, admin.ctx.userId as string)).rejects.toMatchObject({
    code: "team_lead_not_ready",
    httpStatus: 503,
  });
  expect(await pointer(team.id)).toBeNull();
});

for (const operation of ["leave", "delete"] as const)
  it(
    "serializes transfer with target " + operation + " without stale account or member pointers",
    async () => {
      const { lead, admin, team } = await fixture();
      const outcomes = await Promise.allSettled([
        transfer(lead.ctx, team.id, admin.ctx.userId as string),
        operation === "leave"
          ? teams.removeMember(admin.ctx, team.id, admin.ctx.userId as string)
          : deleteAccount(admin.ctx),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = outcomes.find((r) => r.status === "rejected");
      expect(failed).toBeDefined();
      if (failed?.status === "rejected") expect([409, 422]).toContain(failed.reason.httpStatus);
      expect(
        (
          await pool.query(
            "SELECT m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=w.lead_user_id JOIN users u ON u.id=m.user_id WHERE w.id=$1",
            [team.id],
          )
        ).rows[0]?.role,
      ).toBe("admin");
    },
  );

it("retains 013 last-admin errors and serializes legacy administrator account deletion", async () => {
  const first = await signedInUser(mail),
    second = await signedInUser(mail);
  const team = await teams.createTeam(first.ctx, "013 마지막 관리자");
  await expect(
    teams.removeMember(first.ctx, team.id, first.ctx.userId as string),
  ).rejects.toMatchObject({ code: "last_admin" });
  await expect(
    teams.changeRole(first.ctx, team.id, first.ctx.userId as string, "member"),
  ).rejects.toMatchObject({ code: "last_admin" });
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
    [team.id, second.ctx.userId],
  );
  const results = await Promise.allSettled([deleteAccount(first.ctx), deleteAccount(second.ctx)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toEqual([
    expect.objectContaining({ reason: expect.objectContaining({ httpStatus: 409 }) }),
  ]);
  expect(
    (await pool.query("SELECT role FROM workspace_members WHERE workspace_id=$1", [team.id])).rows,
  ).toEqual([{ role: "admin" }]);
  expect(await pointer(team.id)).toBeNull();
});

for (const target of ["admin", "member"] as const)
  it("keeps 013 uppercase UUID " + target + " self-exit and personal session handoff", async () => {
    const f = await fixture(false);
    const actor = target === "admin" ? f.admin : f.member;
    const home = actor.ctx.workspaceId;
    const selected = await teams.switchWorkspace(actor.token, f.team.id);
    const ctx = await requireSession(selected.token);
    const source = await createSource(ctx, exampleSource);
    const response = await leaveRoute(
      new Request("http://localhost:3200/api/workspaces/test", {
        method: "DELETE",
        headers: { origin: "http://localhost:3200", cookie: `gm_owner=${selected.token}` },
      }),
      {
        params: Promise.resolve({
          id: f.team.id.toUpperCase(),
          userId: (actor.ctx.userId as string).toUpperCase(),
        }),
      },
    );
    expect(response.status).toBe(200);
    const replacement =
      response.headers.get("set-cookie")?.split(";")[0]?.slice("gm_owner=".length) ?? "";
    await expect(requireSession(replacement)).resolves.toMatchObject({
      workspaceId: home,
      userId: actor.ctx.userId,
    });
    await expect(requireSession(selected.token)).rejects.toMatchObject({ httpStatus: 401 });
    expect((await pool.query("SELECT id FROM sources WHERE id=$1", [source.id])).rowCount).toBe(1);
    expect(await pointer(f.team.id)).toBeNull();
  });
