import { afterAll, expect, it } from "vitest";
import { GET } from "../../src/app/api/sources/[id]/revisions/[revision]/status/route.ts";
import { pool } from "../../src/lib/db.ts";
import { claimDocumentJob, completeDocumentJob } from "../../src/lib/document-jobs.ts";
import { readDocument } from "../../src/lib/documents/read.ts";
import { getDocumentStatus } from "../../src/lib/document-status.ts";
import { createFileSource, fileContent, getFileRevision } from "../../src/lib/file-sources.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { exampleDraft } from "../fixtures/manual-example.ts";
import { setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

const bytes = new TextEncoder().encode("name,value\nPRIVATE_BODY,1");
async function fixture() {
  const session = await createWorkspace();
  const ctx = await requireSession(session.token);
  const saved = await createFileSource(ctx, { title: "비공개 합성", fileName: "case.csv", bytes });
  return { session, ctx, saved };
}
async function request(token: string, id: string, reader = false, revision = "1") {
  return GET(new Request("http://localhost:3200/api/sources/" + id + "/revisions/" + revision + "/status", {
    headers: { cookie: (reader ? "gm_reader=" : "gm_owner=") + token, ...(reader ? { "x-ghost-role": "reader" } : {}) },
  }), { params: Promise.resolve({ id, revision }) });
}
async function complete() {
  const job = await claimDocumentJob();
  if (!job) throw new Error("Expected queued job");
  expect(await completeDocumentJob(job, readDocument("csv", bytes))).toBe(true);
}
afterAll(() => pool.end());
it("returns only identity and status with no-store and preserves pending download block", async () => {
  const { session, ctx, saved } = await fixture();
  const response = await request(session.token, saved.id);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.json()).toEqual({ revisionId: saved.revisionId, status: "queued" });
  await expect(fileContent(ctx, saved.id, 1)).rejects.toMatchObject({ httpStatus: 409 });
  await complete();
  expect(await getDocumentStatus(ctx, saved.id, 1)).toEqual({ revisionId: saved.revisionId, status: "ready" });
});
it("scopes source, revision and workspace and rechecks expired sessions", async () => {
  const { session, ctx, saved } = await fixture();
  const other = await createWorkspace();
  expect((await request(other.token, saved.id)).status).toBe(404);
  expect((await request(session.token, saved.id, false, "2")).status).toBe(404);
  expect((await request("invalid", saved.id)).status).toBe(401);
  expect((await request(session.token, saved.id, false, "0")).status).toBe(422);
  await complete();
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [ctx.sessionId]);
  expect((await request(session.token, saved.id)).status).toBe(401);
  await expect(getDocumentStatus(ctx, saved.id, 1)).rejects.toMatchObject({ httpStatus: 401 });
});
it("keeps Reader out even when its published document is readable", async () => {
  const { ctx } = await signedInUser(setupFileMail());
  const saved = await createFileSource(ctx, { title: "게시 합성", fileName: "case.csv", bytes });
  await complete();
  const draft = await saveDraft(ctx, saved.revisionId, { ...exampleDraft, references: [], unknowns: [] });
  await publishManual(ctx, draft.id, draft.draftRevision, draft.draft.unknowns);
  const share = await shareWithNewReader(ctx, draft.id);
  const reader = await requireSession(share.token);
  expect((await getFileRevision(reader, saved.id, 1)).extraction?.status).toBe("ready");
  expect((await request(share.token, saved.id, true)).status).toBe(403);
});
it("does not authorize a later detail read after status succeeds and session is revoked", async () => {
  const { session, ctx, saved } = await fixture();
  await complete();
  expect((await request(session.token, saved.id)).status).toBe(200);
  await pool.query("DELETE FROM sessions WHERE id=$1", [ctx.sessionId]);
  await expect(getFileRevision(ctx, saved.id, 1)).rejects.toMatchObject({ httpStatus: 401 });
});

it("rechecks team membership both at the route and inside the locked transaction", async () => {
  const { ctx: account } = await signedInUser(setupFileMail());
  const { session, ctx, saved } = await fixture();
  await complete();
  await pool.query("UPDATE sessions SET user_id=$1 WHERE id=$2", [account.userId, ctx.sessionId]);
  await pool.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member')",
    [ctx.workspaceId, account.userId]);
  const member = await requireSession(session.token);
  expect((await request(session.token, saved.id)).status).toBe(200);
  await pool.query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    [ctx.workspaceId, account.userId]);
  expect((await request(session.token, saved.id)).status).toBe(401);
  await expect(getDocumentStatus(member, saved.id, 1)).rejects.toMatchObject({ httpStatus: 401 });
});
