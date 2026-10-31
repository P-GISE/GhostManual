import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { updateProfile } from "../../src/lib/accounts.ts";
import { pool } from "../../src/lib/db.ts";
import { addFileRevision, answerQuestion, createFileSource } from "../../src/lib/file-sources.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { createSource } from "../../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`));
const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200";
let mail = "";
beforeAll(() => {
  mail = setupFileMail();
  delete process.env["AI_ENABLED"];
  process.env["IP_HASH_SECRET"] = "test-only-rate-secret-00000000000000000000";
});
afterAll(async () => {
  await pool.end();
});

it("freezes the file change history into the published version", async () => {
  const { ctx } = await signedInUser(mail);
  await updateProfile(ctx, { name: "박효민", department: "재무팀" });
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  const draft = await saveDraft(ctx, v1.revisionId, {
    ...exampleDraft,
    unknowns: [],
    references: [],
  });
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "정산_1030.xlsx",
    bytes: fixture("정산_1030.xlsx"),
    expectedRevision: 1,
  });
  const question = v2.questions[0];
  if (!question) throw new Error("expected a question");
  await answerQuestion(ctx, v1.id, 2, question.id, { answer: "거래처별 보고용" });
  const manual = await getManual(ctx, draft.id);
  const published = await publishManual(ctx, draft.id, manual.draftRevision, manual.draft.unknowns);
  expect(
    published.history?.revisions.map((r) => [r.revision, r.fileName, r.uploadedByDepartment]),
  ).toEqual([
    [1, "정산_1029.xlsx", "재무팀"],
    [2, "정산_1030.xlsx", "재무팀"],
  ]);
  const v2History = published.history?.revisions[1];
  expect(v2History?.changes.map((c) => c.kind)).toEqual([
    "sheet_added",
    "formula_changed",
    "values_changed",
  ]);
  expect(v2History?.questions[0]).toEqual({
    question: question.question,
    answer: "거래처별 보고용",
    skipped: false,
  });
  await answerQuestion(ctx, v1.id, 2, question.id, { answer: "나중에 고친 답변" });
  const after = await getManual(ctx, draft.id);
  expect(after.published?.history?.revisions[1]?.questions[0]?.answer).toBe("거래처별 보고용");
});
it("keeps history null for text manuals", async () => {
  const { ctx } = await signedInUser(mail);
  const source = await createSource(ctx, exampleSource);
  const draft = await saveDraft(ctx, source.revisionId, exampleDraft);
  const published = await publishManual(ctx, draft.id, draft.draftRevision, exampleDraft.unknowns);
  expect(published.history).toBeNull();
});
it("rejects text edits and AI drafts on file sources", async () => {
  const { PATCH } = await import("../../src/app/api/sources/[id]/route.ts");
  const { POST } = await import("../../src/app/api/sources/[id]/generate/route.ts");
  const { ctx, token } = await signedInUser(mail);
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  const headers = { origin, cookie: `gm_owner=${token}`, "content-type": "application/json" };
  const params = { params: Promise.resolve({ id: v1.id }) };
  const patch = await PATCH(
    new Request(`${origin}/api/sources/${v1.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "t", text: "가".repeat(120), expectedRevision: 1 }),
    }),
    params,
  );
  expect(patch.status).toBe(422);
  expect((await patch.json()).error.code).toBe("file_source_readonly");
  const generate = await POST(
    new Request(`${origin}/api/sources/${v1.id}/generate`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "file-source-generate" },
      body: JSON.stringify({ expectedRevision: 1 }),
    }),
    params,
  );
  expect(generate.status).toBe(422);
  expect((await generate.json()).error.code).toBe("file_source_readonly");
});
