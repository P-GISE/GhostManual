import { afterAll, expect, it } from "vitest";
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
