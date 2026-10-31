import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "../../src/lib/db.ts";
import {
  addFileRevision,
  answerQuestion,
  createFileSource,
  getFileRevision,
} from "../../src/lib/file-sources.ts";
import { getManual, saveDraft } from "../../src/lib/manuals.ts";
import { createSource } from "../../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`));
let mail = "";
beforeAll(() => {
  mail = setupFileMail();
  delete process.env["AI_ENABLED"];
});
afterAll(async () => {
  await pool.end();
});
async function firstVersion() {
  const { ctx } = await signedInUser(mail);
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  return { ctx, v1 };
}

it("compares a new version and stores rule questions in priority order", async () => {
  const { ctx, v1 } = await firstVersion();
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "정산_1030.xlsx",
    bytes: fixture("정산_1030.xlsx"),
    expectedRevision: 1,
  });
  expect(v2).toMatchObject({ revision: 2, title: "월간 정산", compareStatus: "compared" });
  expect(v2.changes.map((c) => [c.position, c.kind, c.sheet])).toEqual([
    [0, "sheet_added", "정산"],
    [1, "formula_changed", "원본"],
    [2, "values_changed", "원본"],
  ]);
  expect(v2.questions).toHaveLength(3);
  expect(v2.questions.every((q) => q.source === "rule" && q.kind === "change")).toBe(true);
  expect(v2.questions[1]?.groupPositions).toEqual([1]);
});
it("marks an identical upload as no_changes without questions", async () => {
  const { ctx, v1 } = await firstVersion();
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
    expectedRevision: 1,
  });
  expect(v2).toMatchObject({ compareStatus: "no_changes", changes: [], questions: [] });
});
it("asks one open question when the workbook is over the comparison limit", async () => {
  const { ctx, v1 } = await firstVersion();
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "huge.xlsx",
    bytes: fixture("huge.xlsx"),
    expectedRevision: 1,
  });
  expect(v2.compareStatus).toBe("limit_exceeded");
  expect(v2.questions.map((q) => q.question)).toEqual(["이번 버전에서 무엇을, 왜 바꿨나요?"]);
});
it("rejects a file version on a text source", async () => {
  const { ctx } = await signedInUser(mail);
  const text = await createSource(ctx, exampleSource);
  await expect(
    addFileRevision(ctx, text.id, {
      fileName: "a.xlsx",
      bytes: fixture("정산_1029.xlsx"),
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "file_type_mismatch", httpStatus: 422 });
});
it("rejects a stale expectedRevision without adding rows", async () => {
  const { ctx, v1 } = await firstVersion();
  await expect(
    addFileRevision(ctx, v1.id, {
      fileName: "정산_1030.xlsx",
      bytes: fixture("정산_1030.xlsx"),
      expectedRevision: 2,
    }),
  ).rejects.toMatchObject({ code: "conflict", httpStatus: 409 });
  const rows = await pool.query(
    "SELECT count(*)::int AS n FROM source_files WHERE workspace_id=$1",
    [ctx.workspaceId],
  );
  expect(rows.rows[0].n).toBe(1);
});
it("flags the linked manual and lists unanswered questions as unknowns", async () => {
  const { ctx, v1 } = await firstVersion();
  const manual = await saveDraft(ctx, v1.revisionId, {
    ...exampleDraft,
    unknowns: ["기존 확인 항목"],
    references: [],
  });
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "정산_1030.xlsx",
    bytes: fixture("정산_1030.xlsx"),
    expectedRevision: 1,
  });
  const after = await getManual(ctx, manual.id);
  expect(after.needsReview).toBe(true);
  expect(after.sourceRevisionId).toBe(v2.revisionId);
  expect(after.draftRevision).toBe(manual.draftRevision + 1);
  expect(after.draft.unknowns).toEqual([
    "기존 확인 항목",
    ...v1.questions.map((q) => `[v1 확인 필요] ${q.question}`),
    ...v2.questions.map((q) => `[v2 확인 필요] ${q.question}`),
  ]);
});
it("POST /api/sources/:id/revisions uploads a new version", async () => {
  const { POST } = await import("../../src/app/api/sources/[id]/revisions/route.ts");
  const { token, ctx } = await signedInUser(mail);
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
  const form = new FormData();
  form.set("expectedRevision", "1");
  form.set("file", new File([fixture("정산_1030.xlsx")], "정산_1030.xlsx"));
  const response = await POST(
    new Request(`${origin}/api/sources/${v1.id}/revisions`, {
      method: "POST",
      headers: { origin, cookie: `gm_owner=${token}` },
      body: form,
    }),
    { params: Promise.resolve({ id: v1.id }) },
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ revision: 2, compareStatus: "compared" });
});

it("reconciles unanswered questions from all versions on late draft creation and save", async () => {
  const { ctx, v1 } = await firstVersion();
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "정산_1030.xlsx",
    bytes: fixture("정산_1030.xlsx"),
    expectedRevision: 1,
  });
  const [first, second] = v2.questions;
  if (!first || !second) throw new Error("expected questions");
  await answerQuestion(ctx, v1.id, 2, first.id, { answer: "done" });
  await answerQuestion(ctx, v1.id, 2, second.id, { skipped: true });
  const input = { ...exampleDraft, references: [], unknowns: ["human"] };
  const expected = [
    "human",
    ...v1.questions.map((q) => `[v1 확인 필요] ${q.question}`),
    ...v2.questions.slice(1).map((q) => `[v2 확인 필요] ${q.question}`),
  ];
  const manual = await saveDraft(ctx, v2.revisionId, input);
  expect(manual.draft.unknowns).toEqual(expected);
  const saved = await saveDraft(ctx, v2.revisionId, input, manual.draftRevision);
  expect(saved.draft.unknowns).toEqual(expected);
  expect(saved.draftRevision).toBe(manual.draftRevision + 1);
});
it("rolls back a new revision and a skipped answer when unknowns have no room", async () => {
  const { ctx, v1 } = await firstVersion();
  for (const question of v1.questions)
    await answerQuestion(ctx, v1.id, 1, question.id, { answer: "done" });
  const human = Array.from({ length: 30 }, (_, i) => `human ${i}`);
  const manual = await saveDraft(ctx, v1.revisionId, {
    ...exampleDraft,
    references: [],
    unknowns: human,
  });
  await expect(
    addFileRevision(ctx, v1.id, {
      fileName: "정산_1030.xlsx",
      bytes: fixture("정산_1030.xlsx"),
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "unknowns_limit", httpStatus: 422 });
  const question = v1.questions[0];
  if (!question) throw new Error("expected a question");
  await expect(answerQuestion(ctx, v1.id, 1, question.id, { skipped: true })).rejects.toMatchObject(
    { code: "unknowns_limit", httpStatus: 422 },
  );
  expect((await getFileRevision(ctx, v1.id, 1)).questions[0]?.answer).toBe("done");
  await expect(getFileRevision(ctx, v1.id, 2)).rejects.toMatchObject({ httpStatus: 404 });
  expect((await getManual(ctx, manual.id)).draft.unknowns).toEqual(human);
  expect((await getManual(ctx, manual.id)).draftRevision).toBe(manual.draftRevision);
});
