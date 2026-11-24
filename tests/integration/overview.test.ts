import { afterAll, afterEach, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/overview/route.ts";
import * as database from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { getOverview } from "../../src/lib/overview.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource } from "../../src/lib/sources.ts";
import {
  acceptInvite,
  createTeam,
  inviteMember,
  removeMember,
  switchWorkspace,
} from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { mailsTo, setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

const pool = database.pool;
afterEach(() => vi.restoreAllMocks());
afterAll(() => pool.end());

const mail = setupFileMail();
async function person() {
  const { ctx, token } = await signedInUser(mail);
  const email = (await pool.query("SELECT email FROM users WHERE id=$1", [ctx.userId])).rows[0]
    .email as string;
  return { ctx, token, email, userId: ctx.userId as string };
}
const inTeam = async (token: string, teamId: string) =>
  requireSession((await switchWorkspace(token, teamId)).token);

it("lists every team the account belongs to with task status, and nothing else", async () => {
  const admin = await person();
  const member = await person();
  const stranger = await person();

  // 팀이 없고 개인 업무도 없으면 빈 결과다.
  expect(await getOverview(admin.ctx)).toEqual({ teams: [], personal: null });

  const personalWork = await createSource(admin.ctx, { ...exampleSource, title: "개인 업무" });
  const first = await createTeam(admin.ctx, "가 팀");
  const second = await createTeam(admin.ctx, "나 팀");
  const adminInFirst = await inTeam(admin.token, first.id);
  const plain = await createSource(adminInFirst, { ...exampleSource, title: "초안 없는 업무" });
  const published = await createSource(adminInFirst, exampleSource);
  const draft = await saveDraft(adminInFirst, published.revisionId, exampleDraft);
  await publishManual(adminInFirst, draft.id, 1, exampleDraft.unknowns);

  // 세션이 첫 팀에 묶여 있어도 두 팀과 개인 업무가 모두 나온다.
  const view = await getOverview(adminInFirst);
  expect(view.teams.map((team) => [team.name, team.role, team.memberCount, team.current])).toEqual([
    ["가 팀", "admin", 1, true],
    ["나 팀", "admin", 1, false],
  ]);
  expect(view.teams[1]?.works).toEqual([]);
  expect(view.personal?.works.map((work) => [work.id, work.createdByName])).toEqual([
    [personalWork.id, null],
  ]);
  const works = view.teams[0]?.works ?? [];
  expect(works.find((work) => work.id === plain.id)).toMatchObject({
    title: "초안 없는 업무",
    manualId: null,
    publishedVersion: null,
    unpublishedChanges: false,
    createdByName: "사용자",
    openQuestions: 0,
    kind: "text",
  });
  expect(works.find((work) => work.id === published.id)).toMatchObject({
    manualId: draft.id,
    manualTitle: exampleDraft.title,
    publishedVersion: 1,
    needsReview: false,
    unpublishedChanges: false,
  });

  // 게시한 뒤 초안을 고치면 미게시 변경으로 나온다.
  await saveDraft(adminInFirst, published.revisionId, { ...exampleDraft, title: "고친 제목" }, 1);
  const edited = (await getOverview(adminInFirst)).teams[0]?.works.find(
    (work) => work.id === published.id,
  );
  expect(edited).toMatchObject({ publishedVersion: 1, unpublishedChanges: true });

  // 팀원이 아니면 그 팀이 보이지 않는다.
  expect(await getOverview(stranger.ctx)).toEqual({ teams: [], personal: null });

  // 초대를 수락하면 보이고, 내보내면 다시 사라진다.
  await inviteMember(adminInFirst, first.id, member.email);
  const token =
    mailsTo(mail, member.email)
      .at(-1)
      ?.match(/\/invite#([A-Za-z0-9_-]{43})/)?.[1] ?? "";
  await acceptInvite(member.ctx, token);
  const joined = await getOverview(member.ctx);
  expect(joined.teams.map((team) => [team.name, team.role, team.memberCount])).toEqual([
    ["가 팀", "member", 2],
  ]);
  expect(joined.teams[0]?.works).toHaveLength(2);
  expect(joined.personal).toBeNull();
  await removeMember(adminInFirst, first.id, member.userId);
  expect(await getOverview(member.ctx)).toEqual({ teams: [], personal: null });
  expect(second.id).not.toBe(first.id);
});

it("keeps authorization and work metadata in one snapshot across a non-current team's membership revocation", async () => {
  const owner = await person(),
    actor = await person();
  const team = await createTeam(owner.ctx, "권한 회수 경합 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [team.id, actor.userId],
  );
  const ownerInTeam = await inTeam(owner.token, team.id);
  const before = await createSource(ownerInTeam, {
    ...exampleSource,
    title: "회수 전에 있던 업무",
  });
  const resume = Promise.withResolvers<void>();
  let paused = false;
  const original = database.transaction;
  const intercept: typeof database.transaction = async (work) =>
    original(async (client) =>
      work(
        new Proxy(client, {
          get(target, key) {
            if (key !== "query") return Reflect.get(target, key);
            return async (sql: string, values?: unknown[]) => {
              const result = await target.query(sql, values);
              if (!paused && sql.startsWith("SELECT w.id,w.team_name AS name,m.role")) {
                paused = true;
                await resume.promise;
              }
              return result;
            };
          },
        }),
      ),
    );
  const spy = vi.spyOn(database, "transaction").mockImplementationOnce(intercept);
  const pending = getOverview(actor.ctx);
  try {
    // Pause after the real authorization query, before the real work query obtains its snapshot.
    await expect.poll(() => paused, { timeout: 2000, interval: 20 }).toBe(true);
    await removeMember(ownerInTeam, team.id, actor.userId);
    const late = await createSource(ownerInTeam, {
      ...exampleSource,
      title: "권한 회수 뒤 생긴 비공개 업무",
    });
    resume.resolve();
    const result = await pending;
    const works = result.teams.find((space) => space.id === team.id)?.works ?? [];
    expect(works.map((work) => work.id)).toEqual([before.id]);
    expect(works.some((work) => work.id === late.id)).toBe(false);
    spy.mockRestore();
    expect((await getOverview(actor.ctx)).teams).toEqual([]);
    await expect(requireSession(actor.token)).resolves.toMatchObject({
      workspaceId: actor.ctx.workspaceId,
    });
  } finally {
    resume.resolve();
    await pending;
    spy.mockRestore();
  }
});

const overviewRequest = (token?: string, reader = false) =>
  new Request("http://localhost:3200/api/overview", {
    headers: {
      ...(token ? { cookie: `${reader ? "gm_reader" : "gm_owner"}=${token}` } : {}),
      ...(reader ? { "x-ghost-role": "reader" } : {}),
    },
  });

it("enforces overview HTTP login, Reader, temporary-owner, expiry and pending-terms boundaries", async () => {
  const owner = await person();
  expect((await GET(overviewRequest())).status).toBe(401);
  expect((await GET(overviewRequest(owner.token))).status).toBe(200);
  const temporary = await createWorkspace();
  expect((await GET(overviewRequest(temporary.token))).status).toBe(404);
  const source = await createSource(owner.ctx, exampleSource);
  const manual = await saveDraft(owner.ctx, source.revisionId, exampleDraft);
  await publishManual(owner.ctx, manual.id, 1, exampleDraft.unknowns);
  const reader = await shareWithNewReader(owner.ctx, manual.id);
  expect((await GET(overviewRequest(reader.token, true))).status).toBe(404);
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [
    owner.ctx.sessionId,
  ]);
  expect((await GET(overviewRequest(owner.token))).status).toBe(401);
  const expired = await person();
  await pool.query("UPDATE workspaces SET expires_at=now()-interval '1 second' WHERE id=$1", [
    expired.ctx.workspaceId,
  ]);
  expect((await GET(overviewRequest(expired.token))).status).toBe(401);
  const pending = await person();
  await pool.query("UPDATE users SET terms_agreed_at=NULL WHERE id=$1", [pending.userId]);
  const response = await GET(overviewRequest(pending.token));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "terms_required" } });
});

it("reports actual 014 leader, deputy and member flags without returning another user's personal work", async () => {
  const lead = await person(),
    deputy = await person(),
    member = await person();
  const team = await createTeam(lead.ctx, "014 개요 역할");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [team.id, deputy.userId, member.userId],
  );
  const privateSource = await createSource(lead.ctx, { ...exampleSource, title: "대표 개인 업무" });
  for (const [actor, role, isLead] of [
    [lead, "admin", true],
    [deputy, "admin", false],
    [member, "member", false],
  ] as const) {
    const response = await GET(overviewRequest(actor.token));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.teams).toEqual([
      expect.objectContaining({ id: team.id, role, leadReady: true, lead: isLead, memberCount: 3 }),
    ]);
    if (isLead)
      expect(result.personal.works.map((work: { id: string }) => work.id)).toEqual([
        privateSource.id,
      ]);
    else expect(result.personal).toBeNull();
  }
});
