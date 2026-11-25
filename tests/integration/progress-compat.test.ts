import { afterAll, expect, it } from "vitest";
import { GET } from "../../src/app/api/workspaces/[id]/progress/route.ts";
import { pool } from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { requireSession } from "../../src/lib/session.ts";
import { createSource } from "../../src/lib/sources.ts";
import { createTeam, switchWorkspace } from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());

it("keeps 013 progress HTTP admin/member/Reader and private-work boundaries", async () => {
  const mail = setupFileMail();
  const owner = await signedInUser(mail),
    admin = await signedInUser(mail),
    member = await signedInUser(mail),
    outsider = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "013 진행 현황 팀");
  await pool.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [team.id, admin.ctx.userId, member.ctx.userId],
  );
  const ownerSession = await switchWorkspace(owner.token, team.id);
  const ctx = await requireSession(ownerSession.token);
  const source = await createSource(ctx, exampleSource);
  const draft = await saveDraft(ctx, source.revisionId, exampleDraft);
  await publishManual(ctx, draft.id, 1, exampleDraft.unknowns);
  const read = (token: string, id: string = team.id, reader = false) =>
    GET(
      new Request(`http://localhost:3200/api/workspaces/${id}/progress`, {
        headers: {
          cookie: `${reader ? "gm_reader" : "gm_owner"}=${token}`,
          ...(reader ? { "x-ghost-role": "reader" } : {}),
        },
      }),
      { params: Promise.resolve({ id }) },
    );
  for (const token of [ownerSession.token, admin.token]) {
    const response = await read(token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total: 1,
      nextCursor: null,
      works: [expect.objectContaining({ id: source.id })],
    });
  }
  expect((await read(member.token)).status).toBe(403);
  expect((await read(outsider.token)).status).toBe(404);
  expect((await read(admin.token, admin.ctx.workspaceId)).status).toBe(404);
  const reader = await shareWithNewReader(ctx, draft.id);
  expect((await read(reader.token, team.id, true)).status).toBe(404);
  await pool.query(
    "UPDATE workspace_members SET role='member' WHERE workspace_id=$1 AND user_id=$2",
    [team.id, admin.ctx.userId],
  );
  expect((await read(admin.token)).status).toBe(403);
});
