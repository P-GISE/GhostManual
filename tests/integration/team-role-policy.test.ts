import { afterAll, expect, it } from "vitest";
import { DELETE as deleteMe } from "../../src/app/api/me/route.ts";
import { POST as transfer } from "../../src/app/api/workspaces/[id]/lead/route.ts";
import {
  DELETE as kick,
  PATCH as role,
} from "../../src/app/api/workspaces/[id]/members/[userId]/route.ts";
import { DELETE as deleteTeam } from "../../src/app/api/workspaces/[id]/route.ts";
import { login } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { requireSession } from "../../src/lib/session.ts";
import { exchangeShare, setSharing } from "../../src/lib/shares.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";
import * as teams from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const mail = setupFileMail();
afterAll(() => pool.end());
const request = (method: string, token: string, input?: unknown, reader = false) =>
  new Request("http://localhost:3200/api/workspaces/test", {
    method,
    headers: {
      origin: "http://localhost:3200",
      "content-type": "application/json",
      cookie: `${reader ? "gm_reader" : "gm_owner"}=${token}`,
      ...(reader ? { "x-ghost-role": "reader" } : {}),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
const context = (id: string, userId?: string) => ({
  params: Promise.resolve({ id, userId: userId ?? "" }),
});
async function fixture() {
  const lead = await signedInUser(mail),
    deputy = await signedInUser(mail),
    other = await signedInUser(mail),
    originalMember = await signedInUser(mail),
    outsider = await signedInUser(mail);
  const team = await teams.createTeam(lead.ctx, "권한표 합성 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'admin'),($1,$4,'member')",
    [team.id, deputy.ctx.userId, other.ctx.userId, originalMember.ctx.userId],
  );
  const selected = await teams.switchWorkspace(originalMember.token, team.id);
  const member = { ctx: await requireSession(selected.token), token: selected.token };
  const source = await createSource(member.ctx, exampleSource);
  const manual = await saveDraft(member.ctx, source.revisionId, exampleDraft);
  await publishManual(member.ctx, manual.id, 1, exampleDraft.unknowns);
  const sharing = await setSharing(member.ctx, manual.id, "link");
  if (sharing.mode !== "link") throw new Error("expected synthetic link");
  const shared = await exchangeShare(sharing.url.split("#")[1] ?? "", outsider.ctx);
  const reader = await requireSession(shared.token);
  const personal = await createSource(lead.ctx, exampleSource);
  return {
    lead,
    deputy,
    other,
    member,
    outsider,
    team,
    source,
    manual,
    reader,
    readerToken: shared.token,
    personal,
    memberHome: originalMember.ctx.workspaceId,
  };
}
async function state(teamId: string, contentOnly = false) {
  const tables = [
    "sources",
    "source_revisions",
    "source_files",
    "revision_questions",
    "manuals",
    "manual_versions",
    "shares",
    "sessions",
    "question_runs",
    "evidence",
    "operation_requests",
    ...(contentOnly ? [] : ["workspaces", "workspace_members", "workspace_invites"]),
  ];
  return Promise.all(
    tables.map(
      async (table) =>
        (
          await pool.query(
            `SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${table === "workspaces" ? "id" : "workspace_id"}=$1 ORDER BY to_jsonb(t)::text`,
            [teamId],
          )
        ).rows,
    ),
  );
}
async function memberPersonal(f: Awaited<ReturnType<typeof fixture>>) {
  const email = (await pool.query("SELECT email FROM users WHERE id=$1", [f.member.ctx.userId]))
    .rows[0]?.email as string;
  const session = await login(email, "correct horse 9");
  return { token: session.token, ctx: await requireSession(session.token) };
}
async function waitForQuery(prefix: string) {
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",
            [prefix + "%"],
          )
        ).rows[0]?.count,
      { timeout: 2000, interval: 20 },
    )
    .toBe(1);
}

it("enforces the actual HTTP role table and preserves every row/session when actions are denied", async () => {
  const f = await fixture();
  const before = await state(f.team.id);
  const cases: Array<[() => Promise<Response>, number]> = [
    [
      () =>
        role(
          request("PATCH", f.deputy.token, { role: "admin" }),
          context(f.team.id, f.member.ctx.userId as string),
        ),
      403,
    ],
    [
      () =>
        role(
          request("PATCH", f.deputy.token, { role: "member" }),
          context(f.team.id, f.other.ctx.userId as string),
        ),
      403,
    ],
    [
      () =>
        role(
          request("PATCH", f.deputy.token, { role: "member" }),
          context(f.team.id, f.deputy.ctx.userId as string),
        ),
      403,
    ],
    [
      () =>
        kick(request("DELETE", f.deputy.token), context(f.team.id, f.other.ctx.userId as string)),
      403,
    ],
    [
      () =>
        kick(request("DELETE", f.deputy.token), context(f.team.id, f.lead.ctx.userId as string)),
      403,
    ],
    [
      () =>
        deleteTeam(request("DELETE", f.deputy.token, { name: f.team.name }), context(f.team.id)),
      403,
    ],
    [
      () =>
        role(
          request("PATCH", f.member.token, { role: "admin" }),
          context(f.team.id, f.member.ctx.userId as string),
        ),
      403,
    ],
    [
      () =>
        kick(request("DELETE", f.member.token), context(f.team.id, f.other.ctx.userId as string)),
      403,
    ],
    [
      () =>
        deleteTeam(request("DELETE", f.member.token, { name: f.team.name }), context(f.team.id)),
      403,
    ],
    [
      () =>
        deleteTeam(request("DELETE", f.outsider.token, { name: f.team.name }), context(f.team.id)),
      404,
    ],
    [
      () =>
        deleteTeam(
          request("DELETE", f.readerToken, { name: f.team.name }, true),
          context(f.team.id),
        ),
      404,
    ],
  ];
  for (const [action, status] of cases) {
    const response = await action();
    expect(response.status).toBe(status);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await state(f.team.id)).toEqual(before);
    expect((await getManual(f.reader, f.manual.id)).id).toBe(f.manual.id);
    expect((await getSource(f.lead.ctx, f.personal.id)).id).toBe(f.personal.id);
  }
  expect(
    (
      await role(
        request("PATCH", f.lead.token, { role: "admin" }),
        context(f.team.id, f.member.ctx.userId as string),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await role(
        request("PATCH", f.lead.token, { role: "member" }),
        context(f.team.id, f.member.ctx.userId as string),
      )
    ).status,
  ).toBe(200);
  expect(
    (await kick(request("DELETE", f.lead.token), context(f.team.id, f.other.ctx.userId as string)))
      .status,
  ).toBe(200);
  expect(
    (await deleteTeam(request("DELETE", f.lead.token, { name: f.team.name }), context(f.team.id)))
      .status,
  ).toBe(200);
  expect((await getSource(f.lead.ctx, f.personal.id)).id).toBe(f.personal.id);
});

it("retains deputy invitations, cancellation, rename and ordinary-member removal", async () => {
  const f = await fixture();
  const invite = await teams.inviteMember(
    f.deputy.ctx,
    f.team.id,
    `policy-${crypto.randomUUID()}@example.invalid`,
  );
  await teams.cancelInvite(f.deputy.ctx, f.team.id, invite.id);
  await teams.renameTeam(f.deputy.ctx, f.team.id, "부관리자 이름 변경");
  const response = await kick(
    request("DELETE", f.deputy.token),
    context(f.team.id, f.member.ctx.userId as string),
  );
  expect(response.status).toBe(200);
  expect(response.headers.has("set-cookie")).toBe(false);
  await expect(requireSession(f.member.token)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(requireSession(f.deputy.token)).resolves.toMatchObject({
    userId: f.deputy.ctx.userId,
  });
  expect((await getManual(f.reader, f.manual.id)).id).toBe(f.manual.id);
  expect((await pool.query("SELECT id FROM sources WHERE id=$1", [f.source.id])).rowCount).toBe(1);
  expect((await teams.listMembers(f.lead.ctx, f.team.id)).name).toBe("부관리자 이름 변경");
});

it("explicitly promotes a member during handoff and rechecks both new and former leader authorization", async () => {
  const f = await fixture();
  const before = await state(f.team.id, true);
  const response = await transfer(
    request("POST", f.lead.token, { userId: (f.member.ctx.userId as string).toUpperCase() }),
    context(f.team.id),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: f.team.id, leadUserId: f.member.ctx.userId });
  expect(response.headers.has("set-cookie")).toBe(false);
  const members = await teams.listMembers(f.member.ctx, f.team.id);
  expect(members.members).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: f.member.ctx.userId, role: "admin", lead: true }),
      expect.objectContaining({ id: f.lead.ctx.userId, role: "admin", lead: false }),
    ]),
  );
  // This cached context still says member; the database must now authorize the new lead.
  expect(f.member.ctx.teamRole).toBe("member");
  await teams.changeRole(f.member.ctx, f.team.id, f.other.ctx.userId as string, "member");
  for (const action of [
    () =>
      role(
        request("PATCH", f.lead.token, { role: "admin" }),
        context(f.team.id, f.other.ctx.userId as string),
      ),
    () => deleteTeam(request("DELETE", f.lead.token, { name: f.team.name }), context(f.team.id)),
    () =>
      transfer(request("POST", f.lead.token, { userId: f.deputy.ctx.userId }), context(f.team.id)),
  ])
    expect((await action()).status).toBe(403);
  expect(await state(f.team.id, true)).toEqual(before);
  expect((await getManual(f.reader, f.manual.id)).id).toBe(f.manual.id);
});

it("rolls member promotion back when storing the new representative fails", async () => {
  const f = await fixture();
  const name = `policy_rollback_${crypto.randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `ALTER TABLE workspaces ADD CONSTRAINT ${name} CHECK (lead_user_id <> '${f.member.ctx.userId}'::uuid) NOT VALID`,
  );
  try {
    const before = await state(f.team.id);
    const response = await transfer(
      request("POST", f.lead.token, { userId: f.member.ctx.userId }),
      context(f.team.id),
    );
    expect(response.status).toBe(503);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await state(f.team.id)).toEqual(before);
    expect((await getManual(f.reader, f.manual.id)).id).toBe(f.manual.id);
  } finally {
    await pool.query(`ALTER TABLE workspaces DROP CONSTRAINT ${name}`);
  }
});

for (const target of ["deputy", "member"] as const)
  it("returns an uppercase-UUID " + target + " self-exit to the personal workspace", async () => {
    const f = await fixture();
    const actor = target === "deputy" ? f.deputy : f.member;
    const home = target === "deputy" ? f.deputy.ctx.workspaceId : f.memberHome;
    const selected =
      target === "deputy"
        ? await teams.switchWorkspace(actor.token, f.team.id)
        : { token: actor.token };
    const response = await kick(
      request("DELETE", selected.token),
      context(f.team.id.toUpperCase(), (actor.ctx.userId as string).toUpperCase()),
    );
    expect(response.status).toBe(200);
    const token =
      response.headers.get("set-cookie")?.split(";")[0]?.slice("gm_owner=".length) ?? "";
    await expect(requireSession(token)).resolves.toMatchObject({
      workspaceId: home,
      userId: actor.ctx.userId,
    });
    await expect(requireSession(selected.token)).rejects.toMatchObject({ httpStatus: 401 });
    expect((await getManual(f.reader, f.manual.id)).id).toBe(f.manual.id);
    expect((await pool.query("SELECT id FROM sources WHERE id=$1", [f.source.id])).rowCount).toBe(
      1,
    );
  });

it("locks all current membership teams before a member's personal account deletion", async () => {
  const f = await fixture();
  const personal = await memberPersonal(f);
  const source = await createSource(personal.ctx, exampleSource);
  const blocker = await pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [f.team.id]);
    pending = deleteMe(request("DELETE", personal.token));
    await waitForQuery("SELECT w.id FROM workspaces w WHERE");
    await blocker.query(
      "UPDATE workspace_members SET role='admin' WHERE workspace_id=$1 AND user_id=$2",
      [f.team.id, f.member.ctx.userId],
    );
    await blocker.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
      f.team.id,
      f.member.ctx.userId,
    ]);
    await blocker.query("COMMIT");
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "lead_transfer_required" } });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect((await getSource(personal.ctx, source.id)).id).toBe(source.id);
    expect((await getManual(f.reader, f.manual.id)).id).toBe(f.manual.id);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await pending;
  }
});

for (const operation of ["promote", "demote", "self-leave", "delete"] as const)
  it(
    "linearizes a handoff against target " +
      operation +
      " without database-error success substitutes",
    async () => {
      const f = await fixture();
      if (operation === "demote")
        await teams.changeRole(f.lead.ctx, f.team.id, f.member.ctx.userId as string, "admin");
      const personal = operation === "delete" ? await memberPersonal(f) : f.member;
      const target = f.member.ctx.userId as string;
      const competing = () =>
        operation === "delete"
          ? deleteMe(request("DELETE", personal.token))
          : operation === "self-leave"
            ? kick(request("DELETE", f.member.token), context(f.team.id, target))
            : role(
                request("PATCH", f.lead.token, {
                  role: operation === "promote" ? "admin" : "member",
                }),
                context(f.team.id, target),
              );
      const [handoff, other] = await Promise.all([
        transfer(request("POST", f.lead.token, { userId: target }), context(f.team.id)),
        competing(),
      ]);
      if (operation === "promote" || operation === "demote") {
        expect(handoff.status).toBe(200);
        expect([200, 403]).toContain(other.status);
      } else {
        expect([handoff.status, other.status].sort()).toEqual(
          handoff.status === 200 ? [200, 409] : [200, 422],
        );
      }
      const row = (
        await pool.query(
          "SELECT w.lead_user_id,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=w.lead_user_id WHERE w.id=$1",
          [f.team.id],
        )
      ).rows[0];
      expect(row?.role).toBe("admin");
      if (handoff.status === 200) expect(row?.lead_user_id).toBe(target);
      expect((await getManual(f.reader, f.manual.id)).id).toBe(f.manual.id);
      expect((await pool.query("SELECT id FROM sources WHERE id=$1", [f.source.id])).rowCount).toBe(
        1,
      );
    },
  );

for (const action of ["role", "delete"] as const)
  it(
    "rejects a queued former leader's " + action + " request after another handoff commits",
    async () => {
      const f = await fixture();
      const before = await state(f.team.id, true);
      const blocker = await pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [f.team.id]);
        pending =
          action === "role"
            ? role(
                request("PATCH", f.lead.token, { role: "admin" }),
                context(f.team.id, f.member.ctx.userId as string),
              )
            : deleteTeam(
                request("DELETE", f.lead.token, { name: f.team.name }),
                context(f.team.id),
              );
        await waitForQuery("SELECT id FROM workspaces WHERE id=ANY");
        await blocker.query("UPDATE workspaces SET lead_user_id=$2 WHERE id=$1", [
          f.team.id,
          f.deputy.ctx.userId,
        ]);
        await blocker.query("COMMIT");
        const response = await pending;
        expect(response.status).toBe(403);
        expect(response.headers.has("set-cookie")).toBe(false);
        expect(await state(f.team.id, true)).toEqual(before);
        expect((await getSource(f.lead.ctx, f.personal.id)).id).toBe(f.personal.id);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await pending;
      }
    },
  );
