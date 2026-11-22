import { randomBytes } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { POST } from "../../src/app/api/sources/[id]/move/route.ts";
import { pool } from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { moveSource } from "../../src/lib/source-move.ts";
import { createSource, getSource } from "../../src/lib/sources.ts";
import { createTeam } from "../../src/lib/teams.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

const mail = setupFileMail();
afterAll(() => pool.end());

it("moves through a restricted role without granting the inner function", async () => {
  const owner = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "합성 이동 팀");
  const source = await createSource(owner.ctx, exampleSource);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("CREATE ROLE gm_move_boundary_test NOLOGIN");
    await db.query("GRANT USAGE ON SCHEMA public TO gm_move_boundary_test");
    await db.query(
      "GRANT EXECUTE ON FUNCTION public.move_personal_source_for_session(text,uuid,uuid) TO gm_move_boundary_test",
    );
    await db.query("SET LOCAL ROLE gm_move_boundary_test");
    expect(
      (
        await db.query(
          "SELECT has_function_privilege(current_user,'public.move_personal_source(uuid,uuid,uuid)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    // A temp relation with the same name must never shadow the owner tables.
    await db.query("CREATE TEMP TABLE sources(id uuid, workspace_id uuid)");
    await db.query("SELECT public.move_personal_source_for_session($1,$2,$3)", [
      owner.token,
      source.id,
      team.id,
    ]);
    await db.query("RESET ROLE");
    expect(
      (await db.query("SELECT workspace_id FROM public.sources WHERE id=$1", [source.id])).rows[0]
        .workspace_id,
    ).toBe(team.id);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
  expect((await getSource(owner.ctx, source.id)).id).toBe(source.id);
});

it("rejects missing acknowledgement, wrong origin and foreign source without moving it", async () => {
  const owner = await signedInUser(mail);
  const other = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "권한 검증 팀");
  const source = await createSource(other.ctx, exampleSource);
  const input = { targetWorkspaceId: team.id, acknowledgeAiHistoryDeletion: true };
  const request = (origin: string, body: unknown) =>
    new Request("http://localhost:3200/api/sources/" + source.id + "/move", {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: "gm_owner=" + owner.token },
      body: JSON.stringify(body),
    });
  const context = { params: Promise.resolve({ id: source.id }) };
  expect((await POST(request("https://wrong.example", input), context)).status).toBe(403);
  expect(
    (await POST(request(process.env["APP_ORIGIN"] ?? "", { targetWorkspaceId: team.id }), context))
      .status,
  ).toBe(422);
  await expect(moveSource(owner.token, source.id, input)).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    moveSource(randomBytes(32).toString("base64url"), source.id, input),
  ).rejects.toMatchObject({ code: "unauthorized" });
  expect((await getSource(other.ctx, source.id)).id).toBe(source.id);
});

it("requires current membership and a live personal owner session", async () => {
  const owner = await signedInUser(mail);
  const other = await signedInUser(mail);
  const team = await createTeam(other.ctx, "다른 합성 팀");
  const source = await createSource(owner.ctx, exampleSource);
  const input = { targetWorkspaceId: team.id, acknowledgeAiHistoryDeletion: true };
  await expect(moveSource(owner.token, source.id, input)).rejects.toMatchObject({
    code: "forbidden",
  });
  await pool.query(
    "DELETE FROM sessions WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
    [owner.token],
  );
  await expect(moveSource(owner.token, source.id, input)).rejects.toMatchObject({
    code: "unauthorized",
  });
});

it("moves through HTTP only after explicit acknowledgement and rejects replay", async () => {
  const owner = await signedInUser(mail);
  const team = await createTeam(owner.ctx, "HTTP 이동 팀");
  const source = await createSource(owner.ctx, exampleSource);
  const request = () =>
    new Request("http://localhost:3200/api/sources/" + source.id + "/move", {
      method: "POST",
      headers: {
        origin: process.env["APP_ORIGIN"] ?? "",
        "content-type": "application/json",
        cookie: "gm_owner=" + owner.token,
      },
      body: JSON.stringify({ targetWorkspaceId: team.id, acknowledgeAiHistoryDeletion: true }),
    });
  const context = { params: Promise.resolve({ id: source.id }) };
  const moved = await POST(request(), context);
  expect(moved.status).toBe(200);
  expect(await moved.json()).toEqual({ moved: true, workspaceId: team.id });
  expect((await POST(request(), context)).status).toBe(404);
  expect(
    (await pool.query("SELECT workspace_id FROM sources WHERE id=$1", [source.id])).rows[0]
      .workspace_id,
  ).toBe(team.id);
});

it("denies expired, pending-consent and reader sessions at the elevated boundary", async () => {
  for (const kind of ["expired", "terms", "reader"]) {
    const owner = await signedInUser(mail);
    const team = await createTeam(owner.ctx, "만료 권한 팀");
    const source = await createSource(owner.ctx, exampleSource);
    let bearer = owner.token;
    if (kind === "reader") {
      const draft = await saveDraft(owner.ctx, source.revisionId, exampleDraft);
      await publishManual(owner.ctx, draft.id, 1, exampleDraft.unknowns);
      bearer = (await shareWithNewReader(owner.ctx, draft.id)).token;
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      if (kind === "expired")
        await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [
          owner.ctx.sessionId,
        ]);
      if (kind === "terms")
        await db.query("UPDATE users SET terms_agreed_at=NULL WHERE id=$1", [owner.ctx.userId]);
      await expect(
        db.query("SELECT public.move_personal_source_for_session($1,$2,$3)", [
          bearer,
          source.id,
          team.id,
        ]),
      ).rejects.toMatchObject({ code: "28000" });
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
    expect((await getSource(owner.ctx, source.id)).id).toBe(source.id);
  }
});
