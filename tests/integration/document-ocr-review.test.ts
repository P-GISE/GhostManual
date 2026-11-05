import { readFileSync } from "node:fs";
import { afterAll, afterEach, expect, it } from "vitest";
import { pool, transaction } from "../../src/lib/db.ts";
import {
  claimDocumentJob,
  completeDocumentJob,
  runDocumentJob,
} from "../../src/lib/document-jobs.ts";
import { documentDetails } from "../../src/lib/document-sources.ts";
import { readDocument } from "../../src/lib/documents/read.ts";
import type { DocumentExtraction } from "../../src/lib/documents/types.ts";
import {
  addFileRevision,
  createFileSource,
  draftFromFile,
  getFileRevision,
} from "../../src/lib/file-sources.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { removeWorkspace } from "../../src/lib/retention.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { getSource } from "../../src/lib/sources.ts";
import type { SessionContext } from "../../src/lib/types.ts";
import { exampleDraft } from "../fixtures/manual-example.ts";
import { setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

const workspaces: string[] = [];
const pdf = new Uint8Array(readFileSync("tests/fixtures/documents/external/scan-ko-v1.pdf"));
async function owner() {
  const ctx = await requireSession((await createWorkspace()).token);
  workspaces.push(ctx.workspaceId);
  return ctx;
}
function ocr(text: string): DocumentExtraction {
  return {
    status: "limited",
    reason: "OCR 원본 확인 필요",
    coverage: [],
    snapshot: {
      v: 1,
      format: "pdf",
      parserVersion: "tika-4.2.0-gm1",
      normalizationVersion: 1,
      extractionMode: "ocr",
      blocks: [{ kind: "page", path: "page/1", text }],
      coverage: [],
      warnings: ["OCR 결과 원본 대조 필요"],
    },
  };
}
async function finish(result: DocumentExtraction) {
  const job = await claimDocumentJob();
  if (!job) throw new Error("Expected leased job");
  expect(await completeDocumentJob(job, result)).toBe(true);
}
async function firstPdf(ctx: SessionContext, text: string) {
  const source = await createFileSource(ctx, {
    title: "합성 OCR 검토",
    fileName: "scan.pdf",
    bytes: pdf,
  });
  await finish(ocr(text));
  return source;
}
async function nextPdf(ctx: SessionContext, id: string, text: string) {
  const source = await addFileRevision(ctx, id, {
    fileName: "scan.pdf",
    bytes: pdf,
    expectedRevision: 1,
  });
  await finish(ocr(text));
  return source;
}
afterEach(async () => {
  for (const id of workspaces.splice(0)) await transaction((db) => removeWorkspace(db, id));
});
afterAll(() => pool.end());
it("offers private provisional OCR review without changing stored results or public guards", async () => {
  const { ctx } = await signedInUser(setupFileMail());
  workspaces.push(ctx.workspaceId);
  const first = await firstPdf(ctx, "PRIVATE_OLD_OCR_7391");
  const second = await nextPdf(ctx, first.id, "PRIVATE_NEW_OCR_7391");
  const stored = async () => ({
    results: (
      await pool.query("SELECT * FROM document_results WHERE revision_id=$1", [second.revisionId])
    ).rows,
    groups: (
      await pool.query("SELECT * FROM change_groups WHERE revision_id=$1", [second.revisionId])
    ).rows,
    questions: (
      await pool.query("SELECT * FROM revision_questions WHERE revision_id=$1", [second.revisionId])
    ).rows,
  });
  const before = await stored();
  const detail = await documentDetails(ctx, first.id, 2);
  expect(detail).toMatchObject({
    comparison: { status: "limit_exceeded", changes: [] },
    ocrReview: {
      status: "review_required",
      changes: [{ before: "PRIVATE_OLD_OCR_7391", after: "PRIVATE_NEW_OCR_7391" }],
    },
  });
  expect(await stored()).toEqual(before);
  expect((await getFileRevision(ctx, first.id, 2)).compareStatus).toBe("limit_exceeded");
  await expect(draftFromFile(ctx, first.id, 2)).rejects.toMatchObject({
    code: "document_not_ready",
  });
  const draft = await saveDraft(ctx, second.revisionId, {
    ...exampleDraft,
    references: [],
    unknowns: [],
  });
  await expect(
    publishManual(ctx, draft.id, draft.draftRevision, draft.draft.unknowns),
  ).rejects.toMatchObject({ code: "review_required" });
  await publishManual(ctx, draft.id, draft.draftRevision, draft.draft.unknowns, true);
  const reader = await requireSession((await shareWithNewReader(ctx, draft.id)).token);
  await expect(documentDetails(reader, first.id, 2)).rejects.toMatchObject({ httpStatus: 403 });
  await expect(documentDetails(await owner(), first.id, 2)).rejects.toMatchObject({
    httpStatus: 404,
  });
  const publicPayload = JSON.stringify([
    await getFileRevision(reader, first.id, 2),
    await getSource(reader, first.id),
    await getManual(reader, draft.id),
  ]);
  expect(publicPayload).not.toMatch(/PRIVATE_OLD_OCR_7391|PRIVATE_NEW_OCR_7391|ocrReview/);
});
it("keeps identical OCR provisional and returns null without an adjacent OCR snapshot", async () => {
  const ctx = await owner(),
    first = await firstPdf(ctx, "SAME_OCR_7391");
  expect(await documentDetails(ctx, first.id, 1)).toHaveProperty("ocrReview", null);
  await nextPdf(ctx, first.id, "SAME_OCR_7391");
  expect(await documentDetails(ctx, first.id, 2)).toMatchObject({
    comparison: { status: "limit_exceeded" },
    ocrReview: { status: "review_required", changes: [] },
  });
});
it("does not add OCR review to native documents", async () => {
  const ctx = await owner(),
    data = new TextEncoder().encode("A,1");
  const first = await createFileSource(ctx, {
    title: "Native",
    fileName: "sample.csv",
    bytes: data,
  });
  await runDocumentJob(async (format, bytes) => readDocument(format, bytes));
  await addFileRevision(ctx, first.id, {
    fileName: "sample.csv",
    bytes: new TextEncoder().encode("A,2"),
    expectedRevision: 1,
  });
  await runDocumentJob(async (format, bytes) => readDocument(format, bytes));
  expect(await documentDetails(ctx, first.id, 2)).toHaveProperty("ocrReview", null);
});
