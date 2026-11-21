import { afterAll, expect, it } from "vitest";
import { workspaceAiAllowed, workspaceStorageLimit } from "../../src/lib/admin.ts";
import { pool, transaction } from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { deleteSource, deleteWorkspace } from "../../src/lib/retention.ts";
import { requireSession } from "../../src/lib/session.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";
import {
  acceptInvite,
  cancelInvite,
  changeRole,
  createTeam,
  deleteTeam,
  inviteMember,
  listMembers,
  listWorkspaces,
  removeMember,
  renameTeam,
  switchWorkspace,
} from "../../src/lib/teams.ts";
import {
  deleteTemplate,
  getTemplate,
  registerTemplate,
} from "../../src/lib/template-extraction.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
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
const inviteToken = (email: string) =>
  mailsTo(mail, email)
    .at(-1)
    ?.match(/\/invite#([A-Za-z0-9_-]{43})/)?.[1] ?? "";
const inTeam = async (token: string, teamId: string) =>
  requireSession((await switchWorkspace(token, teamId)).token);

it("creates a team, invites by email and keeps non-members out", async () => {
  const admin = await person();
  const member = await person();
  const stranger = await person();
  const team = await createTeam(admin.ctx, " 정산팀 ");
  expect(team).toMatchObject({ name: "정산팀", role: "admin" });
  expect(await listWorkspaces(admin.ctx)).toEqual([
    { id: admin.ctx.workspaceId, name: null, role: null, current: true },
    { id: team.id, name: "정산팀", role: "admin", current: false },
  ]);
  // 팀원이 아닌 사람에게는 팀이 없는 것처럼 보인다.
  await expect(switchWorkspace(stranger.token, team.id)).rejects.toMatchObject({ httpStatus: 404 });
  await expect(listMembers(stranger.ctx, team.id)).rejects.toMatchObject({ httpStatus: 404 });
  await expect(inviteMember(stranger.ctx, team.id, member.email)).rejects.toMatchObject({
    httpStatus: 404,
  });

  await inviteMember(admin.ctx, team.id, member.email.toUpperCase());
  const first = inviteToken(member.email);
  expect(first).toHaveLength(43);
  // 다시 보내면 이전 링크는 못 쓰고 새 링크만 쓴다.
  await inviteMember(admin.ctx, team.id, member.email);
  const token = inviteToken(member.email);
  await expect(acceptInvite(member.ctx, first)).rejects.toMatchObject({ httpStatus: 404 });
  const listed = await listMembers(admin.ctx, team.id);
  expect(listed.invites).toHaveLength(1);
  expect(listed.invites[0]).toMatchObject({ email: member.email, expired: false });
  // 초대받은 이메일의 계정만 수락할 수 있다.
  await expect(acceptInvite(stranger.ctx, token)).rejects.toMatchObject({ httpStatus: 403 });
  expect(await acceptInvite(member.ctx, token)).toEqual({ id: team.id, name: "정산팀" });
  await expect(acceptInvite(member.ctx, token)).rejects.toMatchObject({ httpStatus: 404 });
  await expect(inviteMember(admin.ctx, team.id, member.email)).rejects.toMatchObject({
    httpStatus: 409,
  });

  const memberInTeam = await inTeam(member.token, team.id);
  expect(memberInTeam).toMatchObject({
    workspaceId: team.id,
    teamRole: "member",
    userId: member.userId,
    role: "owner",
  });
  // 팀원 목록: 이메일과 대기 중인 초대는 팀 관리자에게만 보인다.
  const asMember = await listMembers(memberInTeam, team.id);
  expect(asMember.members).toHaveLength(2);
  expect(asMember.members.every((row) => !("email" in row))).toBe(true);
  expect(asMember.invites).toEqual([]);
  expect((await listMembers(admin.ctx, team.id)).members.map((row) => row["email"])).toContain(
    member.email,
  );
  // 팀원은 초대·이름 변경·역할 변경·내보내기를 할 수 없다.
  for (const attempt of [
    () => inviteMember(memberInTeam, team.id, stranger.email),
    () => renameTeam(memberInTeam, team.id, "새 이름"),
    () => changeRole(memberInTeam, team.id, member.userId, "admin"),
    () => removeMember(memberInTeam, team.id, admin.userId),
    () => deleteTeam(memberInTeam, team.id, "정산팀"),
  ])
    await expect(attempt()).rejects.toMatchObject({ httpStatus: 403 });
  const pending = await inviteMember(admin.ctx, team.id, stranger.email);
  await cancelInvite(admin.ctx, team.id, pending.id);
  await expect(acceptInvite(stranger.ctx, inviteToken(stranger.email))).rejects.toMatchObject({
    httpStatus: 404,
  });
});

it("lets members edit everything but delete only what they uploaded", async () => {
  const admin = await person();
  const member = await person();
  const team = await createTeam(admin.ctx, "운영팀");
  await inviteMember(admin.ctx, team.id, member.email);
  await acceptInvite(member.ctx, inviteToken(member.email));
  const adminInTeam = await inTeam(admin.token, team.id);
  const memberInTeam = await inTeam(member.token, team.id);

  const byAdmin = await createSource(adminInTeam, exampleSource);
  const byMember = await createSource(memberInTeam, {
    ...exampleSource,
    title: "팀원이 올린 업무",
  });
  // 팀원 누구나 팀의 업무를 보고 매뉴얼을 쓰고 게시한다. 게시본에는 게시한 사람의 이름이 남는다.
  expect(await getSource(memberInTeam, byAdmin.id)).toMatchObject({
    title: exampleSource.title,
    canDelete: false,
    createdByName: "사용자",
  });
  expect((await getSource(memberInTeam, byMember.id)).canDelete).toBe(true);
  expect((await getSource(adminInTeam, byMember.id)).canDelete).toBe(true);
  // 개인 문서함에서는 올린 사람을 따로 보이지 않는다.
  const personal = await createSource(member.ctx, exampleSource);
  expect(await getSource(member.ctx, personal.id)).toMatchObject({
    canDelete: true,
    createdByName: null,
  });
  const draft = await saveDraft(memberInTeam, byAdmin.revisionId, exampleDraft);
  const published = await publishManual(memberInTeam, draft.id, 1, exampleDraft.unknowns);
  expect(
    (await pool.query("SELECT published_by_name FROM manual_versions WHERE id=$1", [published.id]))
      .rows[0].published_by_name,
  ).toBe("사용자");
  // 개인 문서함에서는 팀 업무가 보이지 않는다.
  await expect(getSource(member.ctx, byAdmin.id)).rejects.toMatchObject({ httpStatus: 404 });

  await expect(deleteSource(memberInTeam, byAdmin.id)).rejects.toMatchObject({ httpStatus: 403 });
  await deleteSource(memberInTeam, byMember.id);
  const other = await createSource(memberInTeam, { ...exampleSource, title: "관리자가 지울 업무" });
  await deleteSource(adminInTeam, other.id);
  // 팀 문서함 전체 삭제는 팀 설정(팀 이름 확인)으로만 한다.
  await expect(deleteWorkspace(adminInTeam)).rejects.toMatchObject({ httpStatus: 403 });

  // 양식도 팀원이 쓰고, 삭제는 올린 사람과 팀 관리자만 한다.
  const template = await registerTemplate(adminInTeam, "인계서.docx", pack(docx(wp("인계 사유"))));
  expect((await getTemplate(memberInTeam, template.id))["id"]).toBe(template.id);
  await expect(deleteTemplate(memberInTeam, template.id)).rejects.toMatchObject({
    httpStatus: 403,
  });
  await deleteTemplate(adminInTeam, template.id);

  // AI 차단은 요청한 계정 기준, 저장 한도는 팀이면 100 MiB 고정.
  await pool.query("UPDATE users SET ai_allowed=false WHERE id=$1", [member.userId]);
  await pool.query("UPDATE users SET storage_limit_bytes=1048576 WHERE id=$1", [admin.userId]);
  expect(await workspaceAiAllowed(team.id, pool, member.userId)).toBe(false);
  expect(await workspaceAiAllowed(team.id, pool, admin.userId)).toBe(true);
  expect(await workspaceAiAllowed(team.id, pool, null)).toBe(true);
  expect(await transaction((db) => workspaceStorageLimit(db, team.id))).toBe(104857600);
  expect(await transaction((db) => workspaceStorageLimit(db, admin.ctx.workspaceId))).toBe(1048576);
});

it("keeps one admin, ends the session of a removed member and deletes a team by its name", async () => {
  const admin = await person();
  const member = await person();
  const team = await createTeam(admin.ctx, "총무팀");
  await inviteMember(admin.ctx, team.id, member.email);
  await acceptInvite(member.ctx, inviteToken(member.email));
  const adminInTeam = await inTeam(admin.token, team.id);
  const kept = await createSource(adminInTeam, exampleSource);

  // 관리자가 한 명뿐이면 나가거나 내려올 수 없다.
  await expect(removeMember(admin.ctx, team.id, admin.userId)).rejects.toMatchObject({
    code: "last_admin",
  });
  await expect(changeRole(admin.ctx, team.id, admin.userId, "member")).rejects.toMatchObject({
    code: "last_admin",
  });
  // 내보내면 그 사람의 팀 세션이 끊기고 자료는 남는다.
  const memberSession = await switchWorkspace(member.token, team.id);
  await removeMember(admin.ctx, team.id, member.userId);
  await expect(requireSession(memberSession.token)).rejects.toMatchObject({ httpStatus: 401 });
  await expect(switchWorkspace(member.token, team.id)).rejects.toMatchObject({ httpStatus: 404 });
  expect((await getSource(adminInTeam, kept.id)).id).toBe(kept.id);

  // 세션이 남아 있는 채로 팀원 자격만 사라진 경우: 요청은 막히고, 같은 토큰으로 내 문서함에 돌아올 수 있다.
  await inviteMember(admin.ctx, team.id, member.email);
  await acceptInvite(member.ctx, inviteToken(member.email));
  const stale = await switchWorkspace(member.token, team.id);
  const staleCtx = await requireSession(stale.token);
  await pool.query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [
    team.id,
    member.userId,
  ]);
  await expect(requireSession(stale.token)).rejects.toMatchObject({ code: "workspace_left" });
  await expect(createSource(staleCtx, exampleSource)).rejects.toMatchObject({ httpStatus: 401 });
  const home = await requireSession((await switchWorkspace(stale.token, null)).token);
  expect(home).toMatchObject({ workspaceId: member.ctx.workspaceId, teamRole: null });

  // 관리자를 넘기면 나갈 수 있다.
  await inviteMember(admin.ctx, team.id, member.email);
  await acceptInvite(member.ctx, inviteToken(member.email));
  await changeRole(admin.ctx, team.id, member.userId, "admin");
  await removeMember(admin.ctx, team.id, admin.userId);
  await expect(listMembers(admin.ctx, team.id)).rejects.toMatchObject({ httpStatus: 404 });

  await expect(deleteTeam(member.ctx, team.id, "총무")).rejects.toMatchObject({ httpStatus: 422 });
  await deleteTeam(member.ctx, team.id, "총무팀");
  expect((await pool.query("SELECT 1 FROM sources WHERE id=$1", [kept.id])).rowCount).toBe(0);
  expect(await listWorkspaces(member.ctx)).toHaveLength(1);
});

it("limits a person to five teams they manage", async () => {
  const admin = await person();
  for (let index = 0; index < 5; index++) await createTeam(admin.ctx, `팀 ${index + 1}`);
  await expect(createTeam(admin.ctx, "여섯 번째")).rejects.toMatchObject({ code: "team_limit" });
  await expect(createTeam(admin.ctx, "")).rejects.toThrow();
});
