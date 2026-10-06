import { afterAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { listManualVersions, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createShare, exchangeShare } from "../../src/lib/shares.ts";
import { createSource } from "../../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";

afterAll(async () => {
  await pool.end();
});
it("returns immutable publications in descending order, excluding drafts", async () => {
  const session = await createWorkspace();
  const owner = await requireSession(session.token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  await saveDraft(owner, source.revisionId, { ...exampleDraft, purpose: "새 검수 목적" }, 1);
  await publishManual(owner, manual.id, 2, exampleDraft.unknowns);
  await saveDraft(owner, source.revisionId, { ...exampleDraft, purpose: "비공개 초안" }, 2);
  const { GET } = await import("../../src/app/api/manuals/[id]/versions/route.ts");
  const request = new Request("http://localhost:3200/api/manuals/versions", {
    headers: { cookie: `gm_owner=${session.token}` },
  });
  const response = await GET(request, { params: Promise.resolve({ id: manual.id }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject([{ version: 2 }, { version: 1 }]);
  const invalid = await GET(request, { params: Promise.resolve({ id: "invalid" }) });
  expect(invalid.status).toBe(422);
  const versions = await listManualVersions(owner, manual.id);
  expect(versions.map((v) => v.version)).toEqual([2, 1]);
  expect(versions.map((v) => v.content.purpose)).toEqual(["새 검수 목적", exampleDraft.purpose]);
  const other = await requireSession((await createWorkspace()).token);
  await expect(listManualVersions(other, manual.id)).rejects.toMatchObject({ httpStatus: 404 });
  const share = await createShare(owner, manual.id);
  const reader = await requireSession(
    (await exchangeShare(new URL(share.url, "http://localhost").hash.slice(1))).token,
  );
  await expect(listManualVersions(reader, manual.id)).rejects.toMatchObject({ httpStatus: 403 });
});
