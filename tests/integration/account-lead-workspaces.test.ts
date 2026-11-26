import { afterAll, expect, it } from "vitest";
import { z } from "zod";
import { GET } from "../../src/app/api/workspaces/route.ts";
import { pool } from "../../src/lib/db.ts";
import { requireSession } from "../../src/lib/session.ts";
import { changeRole, createTeam, switchWorkspace, transferTeamLead } from "../../src/lib/teams.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const mail = setupFileMail();
afterAll(() => pool.end());
const WorkspaceSchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string().nullable(),
  role: z.enum(["admin", "member"]).nullable(),
  lead: z.boolean(),
  current: z.boolean(),
});
async function workspaces(token: string) {
  const response = await GET(
    new Request("http://localhost:3200/api/workspaces", {
      headers: { cookie: `gm_owner=${token}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return z.array(WorkspaceSchema).parse(await response.json());
}

it("returns only own lead status without other account IDs or outsider teams", async () => {
  const owner = await signedInUser(mail);
  const deputy = await signedInUser(mail);
  const member = await signedInUser(mail);
  const outsider = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "대표 안내 팀");
  const hidden = await createTeam(outsider.ctx, "접근 불가 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [team.id, deputy.ctx.userId, member.ctx.userId],
  );
  expect(await workspaces(owner.token)).toEqual([
    { id: owner.ctx.workspaceId, name: null, role: null, lead: false, current: true },
    { id: team.id, name: team.name, role: "admin", lead: true, current: false },
  ]);
  for (const [person, role] of [
    [deputy, "admin"],
    [member, "member"],
  ] as const) {
    expect(await workspaces(person.token)).toEqual([
      { id: person.ctx.workspaceId, name: null, role: null, lead: false, current: true },
      { id: team.id, name: team.name, role, lead: false, current: false },
    ]);
  }
  const outsideRows = await workspaces(outsider.token);
  expect(outsideRows.map((row) => row.id).sort()).toEqual(
    [outsider.ctx.workspaceId, hidden.id].sort(),
  );
  expect(outsideRows.some((row) => row.id === team.id)).toBe(false);
});

it("lists all led teams from personal and another team's active session", async () => {
  const owner = await signedInUser(mail);
  const other = await signedInUser(mail);
  const first = await createTeam(owner.ctx, "대표 A");
  const second = await createTeam(owner.ctx, "대표 B");
  const selected = await createTeam(other.ctx, "참여 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [selected.id, owner.ctx.userId],
  );
  const personal = await workspaces(owner.token);
  expect(
    personal
      .filter((row) => row.lead)
      .map((row) => row.id)
      .sort(),
  ).toEqual([first.id, second.id].sort());
  expect(personal.filter((row) => row.current).map((row) => row.id)).toEqual([
    owner.ctx.workspaceId,
  ]);
  const switched = await switchWorkspace(owner.token, selected.id);
  const fromTeam = await workspaces(switched.token);
  expect(
    fromTeam
      .filter((row) => row.lead)
      .map((row) => row.id)
      .sort(),
  ).toEqual([first.id, second.id].sort());
  expect(fromTeam.filter((row) => row.current)).toEqual([
    { id: selected.id, name: selected.name, role: "member", lead: false, current: true },
  ]);
});

it("refreshes own lead and role after transfer and a subsequent role change", async () => {
  const owner = await signedInUser(mail);
  const successor = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "이양 상태 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [team.id, successor.ctx.userId],
  );
  expect((await workspaces(owner.token)).find((row) => row.id === team.id)?.lead).toBe(true);
  const activeOwner = await switchWorkspace(owner.token, team.id);
  const activeSuccessor = await switchWorkspace(successor.token, team.id);
  const ownerCtx = await requireSession(activeOwner.token);
  const successorCtx = await requireSession(activeSuccessor.token);
  await transferTeamLead(ownerCtx, team.id, successor.ctx.userId as string);
  expect((await workspaces(activeOwner.token)).find((row) => row.id === team.id)).toMatchObject({
    role: "admin",
    lead: false,
  });
  expect((await workspaces(activeSuccessor.token)).find((row) => row.id === team.id)).toMatchObject(
    {
      role: "admin",
      lead: true,
    },
  );
  await changeRole(successorCtx, team.id, owner.ctx.userId as string, "member");
  expect((await workspaces(activeOwner.token)).find((row) => row.id === team.id)).toMatchObject({
    role: "member",
    lead: false,
  });
});
