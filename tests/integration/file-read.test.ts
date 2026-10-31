import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import {
  addFileRevision,
  answerQuestion,
  createFileSource,
  fileContent,
  getFileRevision,
  listFileRevisions,
} from "../../src/lib/file-sources.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { requireSession } from "../../src/lib/session.ts";
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
async function twoVersions() {
  const { ctx, token } = await signedInUser(mail);
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  const manual = await saveDraft(ctx, v1.revisionId, {
    ...exampleDraft,
    unknowns: [],
    references: [],
  });
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "정산_1030.xlsx",
    bytes: fixture("정산_1030.xlsx"),
    expectedRevision: 1,
  });
  return { ctx, token, v1, v2, manualId: manual.id };
}

it("lists versions newest first and previews at most 20 rows by 12 columns", async () => {
  const { ctx, v1 } = await twoVersions();
  const list = await listFileRevisions(ctx, v1.id);
  expect(list.map((r) => [r.revision, r.compareStatus, r.changeCount, r.questionCount])).toEqual([
    [2, "compared", 3, 3],
    [1, "first", 0, 2],
  ]);
  expect(list[1]?.file.name).toBe("정산_1029.xlsx");
  const detail = await getFileRevision(ctx, v1.id, 2);
  expect(detail.preview.map((p) => p.sheet)).toEqual(["원본", "정산"]);
  for (const sheet of detail.preview) {
    expect(sheet.cells.length).toBeLessThanOrEqual(20);
    expect(sheet.cells.every((row) => row.length <= 12)).toBe(true);
  }
  expect(detail.preview[0]?.cells[0]?.[0]).toBeTypeOf("string");
});
it("returns the original bytes for download", async () => {
  const { ctx, v1 } = await twoVersions();
  const file = await fileContent(ctx, v1.id, 1);
  expect(file.fileName).toBe("정산_1029.xlsx");
  expect(Buffer.from(file.bytes).equals(Buffer.from(fixture("정산_1029.xlsx")))).toBe(true);
});
it("download route sends attachment, nosniff and no-store", async () => {
  const { GET } = await import("../../src/app/api/sources/[id]/revisions/[revision]/file/route.ts");
  const { token, v1 } = await twoVersions();
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  const response = await GET(
    new Request(`${origin}/api/sources/${v1.id}/revisions/1/file`, {
      headers: { cookie: `gm_owner=${token}` },
    }),
    { params: Promise.resolve({ id: v1.id, revision: "1" }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename*=UTF-8''${encodeURIComponent("정산_1029.xlsx")}`,
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("keeps the manual's unknowns in step with answers and skips", async () => {
  const { ctx, v1, v2, manualId } = await twoVersions();
  const [first, second] = v2.questions;
  if (!first || !second) throw new Error("expected questions");
  const tag = (q: string) => `[v2 확인 필요] ${q}`;
  expect(
    await answerQuestion(ctx, v1.id, 2, first.id, { answer: "거래처별 보고용" }),
  ).toMatchObject({
    answer: "거래처별 보고용",
    skipped: false,
  });
  let draft = (await getManual(ctx, manualId)).draft;
  expect(draft.unknowns).not.toContain(tag(first.question));
  expect(draft.unknowns).toContain(tag(second.question));
  await answerQuestion(ctx, v1.id, 2, first.id, { skipped: true });
  await answerQuestion(ctx, v1.id, 2, second.id, { answer: "반품 제외" });
  draft = (await getManual(ctx, manualId)).draft;
  expect(draft.unknowns.filter((u) => u === tag(first.question))).toHaveLength(1);
  expect(draft.unknowns).not.toContain(tag(second.question));
  await expect(
    answerQuestion(ctx, v1.id, 2, first.id, { answer: "가".repeat(2001) }),
  ).rejects.toMatchObject({ httpStatus: 422 });
});
it("limits a reader to the published version", async () => {
  const { ctx, v1, manualId } = await twoVersions();
  const manual = await getManual(ctx, manualId);
  await publishManual(ctx, manualId, manual.draftRevision, manual.draft.unknowns);
  const reader = await requireSession((await shareWithNewReader(ctx, manualId)).token);
  expect((await listFileRevisions(reader, v1.id)).map((r) => r.revision)).toEqual([2]);
  expect((await getFileRevision(reader, v1.id, 2)).revision).toBe(2);
  await expect(fileContent(reader, v1.id, 1)).rejects.toMatchObject({ httpStatus: 404 });
  const question = (await getFileRevision(reader, v1.id, 2)).questions[0];
  if (!question) throw new Error("expected a question");
  await expect(
    answerQuestion(reader, v1.id, 2, question.id, { answer: "x" }),
  ).rejects.toMatchObject({ httpStatus: 403 });
});
