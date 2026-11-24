import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { getOverview } from "../../src/lib/overview.ts";
import { requireSession } from "../../src/lib/session.ts";
import { createSource } from "../../src/lib/sources.ts";
import {
  acceptInvite,
  createTeam,
  inviteMember,
  removeMember,
  switchWorkspace,
} from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { mailsTo, setupFileMail, signedInUser } from "./mail-helper.ts";

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
