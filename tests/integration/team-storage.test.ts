import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { deleteAccount } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { createFileSource } from "../../src/lib/file-sources.ts";
import { cleanupExpired } from "../../src/lib/retention.ts";
import { createSource } from "../../src/lib/sources.ts";
import { registerTemplate } from "../../src/lib/template-extraction.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

afterAll(() => pool.end());

it("keeps team sources after a member account is deleted", async () => {
  const { ctx } = await signedInUser(setupFileMail());
  const account = await pool.query("SELECT user_id FROM sessions WHERE id=$1", [ctx.sessionId]);
  const userId = account.rows[0].user_id;
  const teamId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  try {
    await pool.query(
      "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank','합성 팀','infinity')",
      [teamId],
    );
    await pool.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
      [teamId, userId],
    );
    await pool.query(
      "INSERT INTO sources(id,workspace_id,revision,created_by) VALUES($1,$2,1,$3)",
      [sourceId, teamId, userId],
    );
    await cleanupExpired(new Date());
    expect((await pool.query("SELECT id FROM workspaces WHERE id=$1", [teamId])).rowCount).toBe(1);
    await deleteAccount(ctx);
    expect(
      (await pool.query("SELECT id FROM workspaces WHERE id=$1", [ctx.workspaceId])).rowCount,
    ).toBe(0);
    expect((await pool.query("SELECT id FROM workspaces WHERE id=$1", [teamId])).rowCount).toBe(1);
    expect(
      (await pool.query("SELECT created_by FROM sources WHERE id=$1", [sourceId])).rows[0]
        .created_by,
    ).toBeNull();
    expect(
      (await pool.query("SELECT 1 FROM workspace_members WHERE workspace_id=$1", [teamId]))
        .rowCount,
    ).toBe(0);
  } finally {
    await pool.query("DELETE FROM workspaces WHERE id=$1", [teamId]);
  }
});

it("rejects expiring or account-owned team workspaces", async () => {
  await expect(
    pool.query("INSERT INTO workspaces(id,mode,team_name) VALUES($1,'blank','만료 팀')", [
      crypto.randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  const { ctx } = await signedInUser(setupFileMail());
  await expect(
    pool.query("UPDATE workspaces SET team_name='개인 소유 팀' WHERE id=$1", [ctx.workspaceId]),
  ).rejects.toMatchObject({ code: "23514" });
  await deleteAccount(ctx);
});

it("blocks the last administrator account deletion and preserves teams after handoff", async () => {
  const mail = setupFileMail();
  const owner = await signedInUser(mail);
  const successor = await signedInUser(mail);
  const user = async (id: string) =>
    (await pool.query("SELECT user_id FROM sessions WHERE id=$1", [id])).rows[0].user_id;
  const ownerId = await user(owner.ctx.sessionId);
  const successorId = await user(successor.ctx.sessionId);
  const teamId = crypto.randomUUID();
  try {
    await pool.query(
      "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank','관리자 팀','infinity')",
      [teamId],
    );
    await pool.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
      [teamId, ownerId],
    );
    await expect(deleteAccount(owner.ctx)).rejects.toMatchObject({ httpStatus: 409 });
    expect((await pool.query("SELECT id FROM users WHERE id=$1", [ownerId])).rowCount).toBe(1);
    await pool.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
      [teamId, successorId],
    );
    await pool.query("UPDATE sessions SET workspace_id=$1 WHERE id=$2", [
      teamId,
      owner.ctx.sessionId,
    ]);
    const selectedTeam = { ...owner.ctx, workspaceId: teamId as typeof owner.ctx.workspaceId };
    await deleteAccount(selectedTeam);
    expect(
      (await pool.query("SELECT id FROM workspaces WHERE id=$1", [owner.ctx.workspaceId])).rowCount,
    ).toBe(0);
    expect((await pool.query("SELECT id FROM workspaces WHERE id=$1", [teamId])).rowCount).toBe(1);
  } finally {
    await pool.query("DELETE FROM workspaces WHERE id=$1", [teamId]);
    await deleteAccount(successor.ctx);
  }
});

it("records the creator through text, spreadsheet, document and template creation", async () => {
  const { ctx } = await signedInUser(setupFileMail());
  try {
    const text = await createSource(ctx, {
      title: "합성 업무",
      text: "합성 업무의 작성자 기록을 확인합니다. ".repeat(12),
    });
    const spreadsheet = await createFileSource(ctx, {
      title: "합성 표",
      fileName: "synthetic.xlsx",
      bytes: new Uint8Array(readFileSync("tests/fixtures/xlsx/정산_1029.xlsx")),
    });
    const bytes = pack(docx(wp("완료 기준")));
    const document = await createFileSource(ctx, {
      title: "합성 문서",
      fileName: "synthetic.docx",
      bytes,
    });
    const template = await registerTemplate(ctx, "synthetic.docx", bytes);
    const user = (await pool.query("SELECT user_id FROM sessions WHERE id=$1", [ctx.sessionId]))
      .rows[0].user_id;
    const sources = await pool.query("SELECT created_by FROM sources WHERE id=ANY($1::uuid[])", [
      [text.id, spreadsheet.id, document.id],
    ]);
    expect(sources.rows).toHaveLength(3);
    expect(sources.rows.every((row) => row.created_by === user)).toBe(true);
    expect(
      (await pool.query("SELECT created_by FROM manual_templates WHERE id=$1", [template.id]))
        .rows[0].created_by,
    ).toBe(user);
  } finally {
    await deleteAccount(ctx);
  }
});

it("serializes concurrent administrator account deletions and retains one administrator", async () => {
  const mail = setupFileMail();
  const first = await signedInUser(mail);
  const second = await signedInUser(mail);
  const teamId = crypto.randomUUID();
  const userIds = (
    await pool.query("SELECT user_id FROM sessions WHERE id=ANY($1::uuid[])", [
      [first.ctx.sessionId, second.ctx.sessionId],
    ])
  ).rows.map((row) => row.user_id);
  try {
    await pool.query(
      "INSERT INTO workspaces(id,mode,team_name,expires_at) VALUES($1,'blank','동시 삭제 팀','infinity')",
      [teamId],
    );
    for (const id of userIds)
      await pool.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
        [teamId, id],
      );
    const outcomes = await Promise.allSettled([
      deleteAccount(first.ctx),
      deleteAccount(second.ctx),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ httpStatus: 409 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id=$1 AND role='admin'",
          [teamId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await pool.query("DELETE FROM workspaces WHERE id=$1", [teamId]);
    for (const account of [first, second]) {
      const present = await pool.query("SELECT id FROM sessions WHERE id=$1", [
        account.ctx.sessionId,
      ]);
      if (present.rowCount) await deleteAccount(account.ctx);
    }
  }
});
