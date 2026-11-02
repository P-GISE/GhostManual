import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import { addFileRevision, cellChanges, createFileSource } from "../../src/lib/file-sources.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { requireSession } from "../../src/lib/session.ts";
import { getSource } from "../../src/lib/sources.ts";
import { exampleDraft } from "../fixtures/manual-example.ts";
import { setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`));
let mail = "";
beforeAll(() => {
  mail = setupFileMail();
  delete process.env["AI_ENABLED"];
});
afterAll(async () => {
  await pool.end();
});
async function twoVersions(second = "정산_1030.xlsx") {
  const { ctx } = await signedInUser(mail);
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  await addFileRevision(ctx, v1.id, {
    fileName: second,
    bytes: fixture(second),
    expectedRevision: 1,
  });
  return { ctx, id: v1.id };
}

it("returns every changed cell of a version against the previous one", async () => {
  const { ctx, id } = await twoVersions();
  const result = await cellChanges(ctx, id, 2);
  expect(result.compared).toBe(true);
  expect(result.total).toBe(result.changes.length);
  expect(result.changes.filter((c) => c.sheet === "원본" && c.after?.f !== undefined)).toHaveLength(
    39,
  );
  expect((await cellChanges(ctx, id, 1)).total).toBe(0);
});
it("caps the list and still reports the full count", async () => {
  const { ctx, id } = await twoVersions();
  const result = await cellChanges(ctx, id, 2, 10);
  expect(result.changes).toHaveLength(10);
  expect(result.total).toBeGreaterThan(170);
});
it("cannot compare when either version was over the comparison limit", async () => {
  const { ctx, id } = await twoVersions("huge.xlsx");
  expect(await cellChanges(ctx, id, 2)).toEqual({ compared: false, total: 0, changes: [] });
});
it("keeps prior cell values owner-only even when the current version is shared", async () => {
  const { ctx, id } = await twoVersions();
  const latest = await getSource(ctx, id);
  const draft = await saveDraft(ctx, latest.revisionId, {
    ...exampleDraft,
    unknowns: [],
    references: [],
  });
  const manual = await getManual(ctx, draft.id);
  await publishManual(ctx, draft.id, manual.draftRevision, manual.draft.unknowns);
  const reader = await requireSession((await shareWithNewReader(ctx, draft.id)).token);
  expect((await getSource(reader, id)).revision).toBe(2);
  await expect(cellChanges(reader, id, 2)).rejects.toMatchObject({ httpStatus: 403 });
  await expect(cellChanges(reader, id, 1)).rejects.toMatchObject({ httpStatus: 403 });
});
