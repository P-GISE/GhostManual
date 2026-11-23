import { afterAll, expect, it } from "vitest";
import { DELETE as leaveTeamRoute } from "../../src/app/api/workspaces/[id]/members/[userId]/route.ts";
import { DELETE as deleteTeamRoute } from "../../src/app/api/workspaces/[id]/route.ts";
import { pool } from "../../src/lib/db.ts";
import { requireSession } from "../../src/lib/session.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";
import { createTeam, switchWorkspace } from "../../src/lib/teams.ts";
import { exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const mail = setupFileMail();
afterAll(() => pool.end());
const request = (token: string, name?: string) =>
  new Request("http://localhost:3200/api/workspaces/test", {
    method: "DELETE",
    headers: {
      origin: "http://localhost:3200",
      cookie: `gm_owner=${token}`,
      "content-type": "application/json",
    },
    ...(name === undefined ? {} : { body: JSON.stringify({ name }) }),
  });
function replacement(response: Response) {
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie.startsWith("gm_owner=")).toBe(true);
  expect(cookie.includes("HttpOnly")).toBe(true);
  expect(cookie.includes("SameSite=Lax")).toBe(true);
  return cookie.split(";")[0]?.slice("gm_owner=".length) ?? "";
}

it("deleting the selected team returns a fresh personal session and revokes every old team session", async () => {
  const admin = await signedInUser(mail);
  const member = await signedInUser(mail);
  const personalSource = await createSource(admin.ctx, exampleSource);
  const team = await createTeam(admin.ctx, "삭제 복귀 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [team.id, member.ctx.userId],
  );
  const active = await switchWorkspace(admin.token, team.id);
  const other = await switchWorkspace(member.token, team.id);
  const response = await deleteTeamRoute(request(active.token, team.name), {
    params: Promise.resolve({ id: team.id }),
  });
  expect(response.status).toBe(200);
  const next = replacement(response);
  expect(next === active.token).toBe(false);
  const home = await requireSession(next);
  expect(home).toMatchObject({
    workspaceId: admin.ctx.workspaceId,
    userId: admin.ctx.userId,
    teamRole: null,
  });
  await expect(requireSession(active.token)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(requireSession(other.token)).rejects.toMatchObject({ httpStatus: 401 });
  expect((await getSource(home, personalSource.id)).id).toBe(personalSource.id);
  expect((await pool.query("SELECT id FROM workspaces WHERE id=$1", [team.id])).rowCount).toBe(0);
});

it("self leave returns home while preserving team data and another member's session", async () => {
  const admin = await signedInUser(mail);
  const member = await signedInUser(mail);
  const team = await createTeam(admin.ctx, "탈퇴 복귀 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [team.id, member.ctx.userId],
  );
  const active = await switchWorkspace(member.token, team.id);
  const owner = await switchWorkspace(admin.token, team.id);
  const source = await createSource(await requireSession(active.token), exampleSource);
  const response = await leaveTeamRoute(request(active.token), {
    params: Promise.resolve({ id: team.id, userId: member.ctx.userId ?? "" }),
  });
  expect(response.status).toBe(200);
  const next = replacement(response);
  expect(next === active.token).toBe(false);
  await expect(requireSession(next)).resolves.toMatchObject({
    workspaceId: member.ctx.workspaceId,
    userId: member.ctx.userId,
  });
  await expect(requireSession(active.token)).rejects.toMatchObject({ httpStatus: 401 });
  const remaining = await requireSession(owner.token);
  expect((await getSource(remaining, source.id)).id).toBe(source.id);
});

it("rejected name, last admin and member deletion preserve the original session and issue no replacement", async () => {
  const admin = await signedInUser(mail);
  const member = await signedInUser(mail);
  const team = await createTeam(admin.ctx, "보호 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [team.id, member.ctx.userId],
  );
  const active = await switchWorkspace(admin.token, team.id);
  const other = await switchWorkspace(member.token, team.id);
  const before = (
    await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=ANY($1::uuid[])", [
      [admin.ctx.userId, member.ctx.userId],
    ])
  ).rows[0]?.n;
  const attempts = [
    [
      await deleteTeamRoute(request(active.token, "오류"), {
        params: Promise.resolve({ id: team.id }),
      }),
      422,
    ],
    [
      await leaveTeamRoute(request(active.token), {
        params: Promise.resolve({ id: team.id, userId: admin.ctx.userId ?? "" }),
      }),
      409,
    ],
    [
      await deleteTeamRoute(request(other.token, team.name), {
        params: Promise.resolve({ id: team.id }),
      }),
      403,
    ],
  ] as const;
  for (const [response, status] of attempts) {
    expect(response.status).toBe(status);
    expect(response.headers.has("set-cookie")).toBe(false);
  }
  await expect(requireSession(active.token)).resolves.toMatchObject({ workspaceId: team.id });
  await expect(requireSession(other.token)).resolves.toMatchObject({ workspaceId: team.id });
  expect(
    (
      await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=ANY($1::uuid[])", [
        [admin.ctx.userId, member.ctx.userId],
      ])
    ).rows[0]?.n,
  ).toBe(before);
});

it("deleting another team does not rotate the caller's unrelated personal session", async () => {
  const admin = await signedInUser(mail);
  const team = await createTeam(admin.ctx, "다른 팀");
  const response = await deleteTeamRoute(request(admin.token, team.name), {
    params: Promise.resolve({ id: team.id }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.has("set-cookie")).toBe(false);
  await expect(requireSession(admin.token)).resolves.toMatchObject({
    workspaceId: admin.ctx.workspaceId,
  });
});

it("removing another member revokes their team session without rotating the admin cookie", async () => {
  const admin = await signedInUser(mail);
  const member = await signedInUser(mail);
  const team = await createTeam(admin.ctx, "내보내기 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [team.id, member.ctx.userId],
  );
  const active = await switchWorkspace(admin.token, team.id);
  const other = await switchWorkspace(member.token, team.id);
  const response = await leaveTeamRoute(request(active.token), {
    params: Promise.resolve({ id: team.id, userId: member.ctx.userId ?? "" }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.has("set-cookie")).toBe(false);
  await expect(requireSession(active.token)).resolves.toMatchObject({ workspaceId: team.id });
  await expect(requireSession(other.token)).rejects.toMatchObject({ httpStatus: 401 });
});

it.each(["delete", "leave"] as const)(
  "%s rolls back when its replacement session cannot be stored",
  async (action) => {
    const admin = await signedInUser(mail);
    const member = await signedInUser(mail);
    const team = await createTeam(admin.ctx, "복구 검증 팀");
    await pool.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
      [team.id, member.ctx.userId],
    );
    const active = await switchWorkspace(admin.token, team.id);
    const ctx = await requireSession(active.token);
    const source = await createSource(ctx, exampleSource);
    const constraint = `test_exit_${crypto.randomUUID().replaceAll("-", "")}`;
    // A fixture-scoped insert failure must roll back the earlier destructive statements too.
    await pool.query(
      `ALTER TABLE sessions ADD CONSTRAINT ${constraint} CHECK (user_id <> '${ctx.userId}'::uuid OR workspace_id <> '${admin.ctx.workspaceId}'::uuid) NOT VALID`,
    );
    try {
      const response =
        action === "delete"
          ? await deleteTeamRoute(request(active.token, team.name), {
              params: Promise.resolve({ id: team.id }),
            })
          : await leaveTeamRoute(request(active.token), {
              params: Promise.resolve({ id: team.id, userId: ctx.userId ?? "" }),
            });
      expect(response.status).toBe(503);
      expect(response.headers.has("set-cookie")).toBe(false);
      const unchanged = await requireSession(active.token);
      expect(unchanged.workspaceId).toBe(team.id);
      expect((await getSource(unchanged, source.id)).id).toBe(source.id);
      expect(
        (
          await pool.query(
            "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
            [team.id, ctx.userId],
          )
        ).rows[0]?.role,
      ).toBe("admin");
    } finally {
      await pool.query(`ALTER TABLE sessions DROP CONSTRAINT ${constraint}`);
    }
  },
);
