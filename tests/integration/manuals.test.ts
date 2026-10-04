import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource, updateSource } from "../../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";

afterAll(async () => {
  await pool.end();
});
async function setup() {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  return { owner, source };
}
it("publishes an immutable reviewed snapshot while subsequent draft edits retain it", async () => {
  const { owner, source } = await setup();
  const draft = await saveDraft(owner, source.revisionId, exampleDraft);
  const published = await publishManual(owner, draft.id, 1, exampleDraft.unknowns);
  await saveDraft(owner, source.revisionId, { ...exampleDraft, title: "담당자 경험 추가" }, 1);
  const current = await getManual(owner, draft.id);
  expect(published.version).toBe(1);
  expect(current.published?.content.title).toBe(exampleDraft.title);
  expect(current.draft.title).toBe("담당자 경험 추가");
  expect(current.provenance).toBe("human");
  await expect(
    pool.query("UPDATE manual_versions SET content='{}' WHERE id=$1", [published.id]),
  ).rejects.toThrow();
});
it("rejects stale draft edits and source revision races", async () => {
  const { owner, source } = await setup();
  const draft = await saveDraft(owner, source.revisionId, exampleDraft);
  await expect(saveDraft(owner, source.revisionId, exampleDraft, 0)).rejects.toMatchObject({
    httpStatus: 409,
  });
  await updateSource(
    owner,
    source.id,
    { ...exampleSource, text: exampleSource.text + "\n\n운영 절차 변경." },
    1,
  );
  expect((await getManual(owner, draft.id)).needsReview).toBe(true);
  await expect(publishManual(owner, draft.id, 1, exampleDraft.unknowns)).rejects.toMatchObject({
    httpStatus: 409,
  });
  await expect(saveDraft(owner, source.revisionId, exampleDraft, 1, "ai")).rejects.toMatchObject({
    httpStatus: 409,
  });
});
it("rejects missing publication fields and unacknowledged unknowns", async () => {
  const { owner, source } = await setup();
  const draft = await saveDraft(owner, source.revisionId, { ...exampleDraft, purpose: null });
  await expect(publishManual(owner, draft.id, 1, exampleDraft.unknowns)).rejects.toMatchObject({
    httpStatus: 422,
  });
  const ready = await saveDraft(owner, source.revisionId, exampleDraft, 1);
  await expect(publishManual(owner, ready.id, 2, [])).rejects.toMatchObject({ httpStatus: 422 });
});
it("rejects fabricated quotes, fields, and other workspace sources", async () => {
  const { owner, source } = await setup();
  const other = await requireSession((await createWorkspace()).token);
  await expect(saveDraft(other, source.revisionId, exampleDraft)).rejects.toMatchObject({
    httpStatus: 404,
  });
  await expect(
    saveDraft(owner, source.revisionId, {
      ...exampleDraft,
      references: [{ field: "steps.0", paragraphId: "p1", quote: "없는 규칙" }],
    }),
  ).rejects.toMatchObject({ httpStatus: 422 });
  await expect(
    saveDraft(owner, source.revisionId, {
      ...exampleDraft,
      references: [{ field: "steps.9", paragraphId: "p1", quote: "신입 구성원" }],
    }),
  ).rejects.toMatchObject({ httpStatus: 422 });
});
it("exposes only the current publication to a shared reader", async () => {
  const { owner, source } = await setup();
  const draft = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, draft.id, 1, exampleDraft.unknowns);
  await saveDraft(owner, source.revisionId, { ...exampleDraft, title: "비공개 초안" }, 1);
  const { freshToken, tokenHash } = await import("../../src/lib/session.ts");
  const token = freshToken();
  const share = await pool.query<{ id: string }>(
    "INSERT INTO shares(id,workspace_id,manual_id,token_hash,expires_at) VALUES(gen_random_uuid(),$1,$2,$3,now()+interval '1 day') RETURNING id",
    [owner.workspaceId, draft.id, tokenHash(freshToken())],
  );
  await pool.query(
    "INSERT INTO sessions(id,workspace_id,token_hash,role,share_id,expires_at) VALUES(gen_random_uuid(),$1,$2,'reader',$3,now()+interval '1 day')",
    [owner.workspaceId, tokenHash(token), share.rows[0]?.id],
  );
  const reader = await requireSession(token);
  const viewed = await getManual(reader, draft.id);
  expect(viewed.draft.title).toBe(exampleDraft.title);
  await expect(saveDraft(reader, source.revisionId, exampleDraft, 2)).rejects.toMatchObject({
    httpStatus: 403,
  });
  const otherSource = await createSource(owner, exampleSource);
  const other = await saveDraft(owner, otherSource.revisionId, exampleDraft);
  await expect(getManual(reader, other.id)).rejects.toMatchObject({ httpStatus: 404 });
});
it("saves and publishes through authenticated HTTP boundaries", async () => {
  const session = await createWorkspace();
  const owner = await requireSession(session.token);
  const source = await createSource(owner, exampleSource);
  process.env["APP_ORIGIN"] = "http://localhost:3200";
  const headers = {
    "content-type": "application/json",
    origin: "http://localhost:3200",
    cookie: `gm_owner=${session.token}`,
  };
  const { POST } = await import("../../src/app/api/manuals/route.ts");
  const response = await POST(
    new Request("http://localhost:3200/api/manuals", {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceRevisionId: source.revisionId, draft: exampleDraft }),
    }),
  );
  const body = await response.json();
  expect(response.status).toBe(201);
  const { ManualViewSchema } = await import("../../src/lib/manuals.ts");
  const manual = ManualViewSchema.omit({ createdAt: true }).parse(body);
  const { POST: publish } = await import("../../src/app/api/manuals/[id]/publish/route.ts");
  const result = await publish(
    new Request("http://localhost:3200/api/manuals/publish", {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 1, acknowledgedUnknowns: exampleDraft.unknowns }),
    }),
    { params: Promise.resolve({ id: manual.id }) },
  );
  expect(result.status).toBe(201);
});
