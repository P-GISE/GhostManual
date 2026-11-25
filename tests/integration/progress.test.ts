import { afterAll, expect, it } from "vitest";
import { GET } from "../../src/app/api/workspaces/[id]/progress/route.ts";
import { pool } from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { getProgress } from "../../src/lib/progress.ts";
import { requireSession } from "../../src/lib/session.ts";
import { createSource } from "../../src/lib/sources.ts";
import {
  acceptInvite,
  changeRole,
  createTeam,
  inviteMember,
  removeMember,
  switchWorkspace,
} from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { mailsTo, setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());

const mail = setupFileMail();
async function person() {
  const { ctx, token } = await signedInUser(mail);
  const email = (await pool.query("SELECT email FROM users WHERE id=$1", [ctx.userId])).rows[0]
    .email as string;
  return { ctx, token, email, userId: ctx.userId as string };
}

it("shows team progress to admins only", async () => {
  const lead = await person();
  const member = await person();
  const stranger = await person();
  const team = await createTeam(lead.ctx, "진행 현황 팀");
  const inTeam = await requireSession((await switchWorkspace(lead.token, team.id)).token);
  const plain = await createSource(inTeam, { ...exampleSource, title: "초안 없는 업무" });
  const published = await createSource(inTeam, exampleSource);
  const draft = await saveDraft(inTeam, published.revisionId, exampleDraft);
  await publishManual(inTeam, draft.id, 1, exampleDraft.unknowns);

  const reader = await shareWithNewReader(inTeam, draft.id);
  expect(
    (
      await GET(
        new Request(`http://localhost:3200/api/workspaces/${team.id}/progress`, {
          headers: { cookie: `gm_reader=${reader.token}`, "x-ghost-role": "reader" },
        }),
        { params: Promise.resolve({ id: team.id }) },
      )
    ).status,
  ).toBe(404);

  // 세션이 개인 문서함이어도 관리자는 팀의 진행 현황을 본다.
  const { works } = await getProgress(lead.ctx, team.id);
  expect(works.map((work) => work.id)).toEqual([published.id, plain.id]);
  expect(works[0]).toMatchObject({
    manualId: draft.id,
    manualTitle: exampleDraft.title,
    publishedVersion: 1,
    needsReview: false,
    unpublishedChanges: false,
    createdByName: "사용자",
    revision: 1,
    openQuestions: 0,
  });
  expect(works[1]).toMatchObject({ title: "초안 없는 업무", manualId: null });

  // 팀원이 아니면 404, 팀원은 403, 부관리자가 되면 본다.
  await expect(getProgress(stranger.ctx, team.id)).rejects.toMatchObject({ httpStatus: 404 });
  await inviteMember(inTeam, team.id, member.email);
  const token =
    mailsTo(mail, member.email)
      .at(-1)
      ?.match(/\/invite#([A-Za-z0-9_-]{43})/)?.[1] ?? "";
  await acceptInvite(member.ctx, token);
  await expect(getProgress(member.ctx, team.id)).rejects.toMatchObject({ httpStatus: 403 });
  await changeRole(inTeam, team.id, member.userId, "admin");
  expect((await getProgress(member.ctx, team.id)).works).toHaveLength(2);
  // 개인 문서함의 id로는 볼 수 없다.
  await expect(getProgress(lead.ctx, lead.ctx.workspaceId)).rejects.toMatchObject({
    httpStatus: 404,
  });
});

async function page(token: string, teamId: string, query = "") {
  return GET(
    new Request(
      `http://localhost:3200/api/workspaces/${teamId}/progress${query ? `?${query}` : ""}`,
      {
        headers: { cookie: `gm_owner=${token}` },
      },
    ),
    { params: Promise.resolve({ id: teamId }) },
  );
}

it("limits progress pages, preserves microsecond ties and rechecks admin rights on every request", async () => {
  const lead = await person(),
    deputy = await person(),
    outsider = await person();
  const team = await createTeam(lead.ctx, "제한 조회 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
    [team.id, deputy.userId],
  );
  const ids = (
    await pool.query<{ id: string }>(
      `INSERT INTO sources(id,workspace_id,revision,created_by,created_at)
    SELECT gen_random_uuid(),$1,1,$2,'2026-11-25T00:00:00.123456Z'::timestamptz FROM generate_series(1,23) RETURNING id`,
      [team.id, lead.userId],
    )
  ).rows
    .map((row) => row.id)
    .sort()
    .reverse();
  await pool.query(
    `INSERT INTO source_revisions(id,workspace_id,source_id,revision,title,text,uploaded_by_name)
    SELECT gen_random_uuid(),workspace_id,id,1,'진행 업무 '||id,repeat('합성 내용 ',20),'합성 담당자' FROM sources WHERE workspace_id=$1`,
    [team.id],
  );
  const firstResponse = await page(deputy.token, team.id);
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json();
  expect(first.works).toHaveLength(10);
  expect(first.total).toBe(23);
  expect(first.works.map((work: { id: string }) => work.id)).toEqual(ids.slice(0, 10));
  const secondResponse = await page(deputy.token, team.id, `afterWork=${first.nextCursor}`);
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json();
  expect(second.works.map((work: { id: string }) => work.id)).toEqual(ids.slice(10, 20));
  const third = await (await page(deputy.token, team.id, `afterWork=${second.nextCursor}`)).json();
  expect(third.works.map((work: { id: string }) => work.id)).toEqual(ids.slice(20));
  expect(third.nextCursor).toBeNull();
  expect(
    new Set(
      [...first.works, ...second.works, ...third.works].map((work: { id: string }) => work.id),
    ).size,
  ).toBe(23);
  expect((await page(outsider.token, team.id, `afterWork=${first.nextCursor}`)).status).toBe(404);
  expect((await page(deputy.token, deputy.ctx.workspaceId)).status).toBe(404);
  await changeRole(lead.ctx, team.id, deputy.userId, "member");
  expect((await page(deputy.token, team.id, `afterWork=${first.nextCursor}`)).status).toBe(403);
  await removeMember(lead.ctx, team.id, deputy.userId);
  expect((await page(deputy.token, team.id, `afterWork=${first.nextCursor}`)).status).toBe(404);
  await pool.query("UPDATE workspaces SET expires_at=now()-interval '1 second' WHERE id=$1", [
    team.id,
  ]);
  expect((await page(lead.token, team.id, `afterWork=${first.nextCursor}`)).status).toBe(404);
});

it("rejects invalid progress cursors, unsupported and duplicate query parameters", async () => {
  const lead = await person();
  const team = await createTeam(lead.ctx, "잘못된 조회 팀");
  for (const query of [
    "limit=9999",
    "afterWork=bad",
    "afterWork=a&afterWork=b",
    "filter=all",
    "afterWork=",
  ]) {
    expect((await page(lead.token, team.id, query)).status, query).toBe(422);
  }
  const noSession = await GET(
    new Request(`http://localhost:3200/api/workspaces/${team.id}/progress`),
    { params: Promise.resolve({ id: team.id }) },
  );
  expect(noSession.status).toBe(401);
});
