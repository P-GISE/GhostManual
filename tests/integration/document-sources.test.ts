import { afterAll, afterEach, expect, it, vi } from "vitest";
import * as ai from "../../src/lib/ai.ts";
import { pool } from "../../src/lib/db.ts";
import {
  claimDocumentJob,
  completeDocumentJob,
  runDocumentJob,
} from "../../src/lib/document-jobs.ts";
import { documentDetails, retryDocument } from "../../src/lib/document-sources.ts";
import { readDocument } from "../../src/lib/documents/read.ts";
import {
  addFileRevision,
  answerQuestion,
  createFileSource,
  draftFromFile,
  fileContent,
  getFileRevision,
  listFileRevisions,
  similarSources,
} from "../../src/lib/file-sources.ts";
import { generateDraft } from "../../src/lib/generation.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { deleteSource } from "../../src/lib/retention.ts";
import { retrieve } from "../../src/lib/retrieval.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { getSource } from "../../src/lib/sources.ts";
import type { SessionContext } from "../../src/lib/types.ts";
import { exampleDraft } from "../fixtures/manual-example.ts";
import { setupFileMail, shareWithNewReader, signedInUser } from "./mail-helper.ts";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected test value");
  return value;
}
const workspaces: string[] = [];
const bytes = (value = "name,value\nA,1") => new TextEncoder().encode(value);
async function owner() {
  const ctx = await requireSession((await createWorkspace()).token);
  workspaces.push(ctx.workspaceId);
  return ctx;
}
async function upload(ctx: SessionContext, value?: string) {
  return createFileSource(ctx, { title: "CSV 업무", fileName: "sample.csv", bytes: bytes(value) });
}
async function finish() {
  expect(await runDocumentJob(async (format, data) => readDocument(format, data))).toBe(true);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of workspaces.splice(0)) {
    await pool.query("DELETE FROM manuals WHERE workspace_id=$1", [id]);
    await pool.query("DELETE FROM workspaces WHERE id=$1", [id]);
  }
});
afterAll(() => pool.end());
it("queues CSV with immutable original bytes and NULL XLSX metadata", async () => {
  const ctx = await owner(),
    view = await upload(ctx);
  expect(view).toMatchObject({
    fileType: "csv",
    extraction: { status: "queued", resultId: null },
    compareStatus: "pending",
    questions: [],
  });
  expect(
    (
      await pool.query("SELECT compare_status,snapshot FROM source_files WHERE revision_id=$1", [
        view.revisionId,
      ])
    ).rows[0],
  ).toEqual({ compare_status: null, snapshot: null });
  await expect(fileContent(ctx, view.id, 1)).rejects.toMatchObject({ code: "document_not_ready" });
  await expect(
    saveDraft(ctx, view.revisionId, { ...exampleDraft, references: [] }),
  ).rejects.toMatchObject({ code: "document_not_ready" });
  await expect(draftFromFile(ctx, view.id, 1)).rejects.toMatchObject({
    code: "document_not_ready",
  });
  await expect(
    generateDraft(ctx, { sourceId: view.id, expectedRevision: 1, key: "pending-document" }),
  ).rejects.toMatchObject({ code: "document_not_ready" });
  await finish();
  expect((await getSource(ctx, view.id)).extraction?.status).toBe("ready");
  expect((await getFileRevision(ctx, view.id, 1)).questions).toHaveLength(2);
  expect((await fileContent(ctx, view.id, 1)).bytes).toEqual(bytes());
  await expect(
    pool.query("UPDATE source_files SET file_name='changed.csv' WHERE revision_id=$1", [
      view.revisionId,
    ]),
  ).rejects.toThrow();
});
it("leases one job, rejects stale completion and records exactly one immutable result", async () => {
  const ctx = await owner(),
    view = await upload(ctx);
  const old = required(await claimDocumentJob());
  expect(old).not.toBeNull();
  expect(await claimDocumentJob()).toBeNull();
  await pool.query("UPDATE document_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [
    old.id,
  ]);
  const current = required(await claimDocumentJob());
  expect(current.token).not.toBe(old.token);
  const extraction = readDocument("csv", bytes());
  expect(await completeDocumentJob(old, extraction)).toBe(false);
  expect(await completeDocumentJob(current, extraction)).toBe(true);
  expect(await completeDocumentJob(current, extraction)).toBe(false);
  expect(
    (
      await pool.query("SELECT count(*)::int n FROM document_results WHERE revision_id=$1", [
        view.revisionId,
      ])
    ).rows[0].n,
  ).toBe(1);
  await expect(
    pool.query("UPDATE document_results SET reason='changed' WHERE revision_id=$1", [
      view.revisionId,
    ]),
  ).rejects.toThrow();
  await expect(
    pool.query(
      "INSERT INTO revision_questions(id,workspace_id,revision_id,position,kind,question) VALUES(gen_random_uuid(),$1,$2,9,'other','later')",
      [ctx.workspaceId, view.revisionId],
    ),
  ).rejects.toThrow();
  const question = required((await getFileRevision(ctx, view.id, 1)).questions[0]);
  await expect(
    pool.query("UPDATE revision_questions SET question='changed' WHERE id=$1", [question.id]),
  ).rejects.toThrow();
});
it("discards completion after deletion and after uploader session revocation", async () => {
  const ctx = await owner(),
    view = await upload(ctx),
    job = required(await claimDocumentJob());
  await deleteSource(ctx, view.id);
  expect(await completeDocumentJob(job, readDocument("csv", bytes()))).toBe(false);
  expect(
    (await pool.query("SELECT count(*)::int n FROM document_jobs WHERE id=$1", [job.id])).rows[0].n,
  ).toBe(0);
  const second = await upload(ctx),
    pending = required(await claimDocumentJob());
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [
    ctx.sessionId,
  ]);
  expect(await completeDocumentJob(pending, readDocument("csv", bytes()))).toBe(false);
  await claimDocumentJob();
  expect(
    (await pool.query("SELECT status FROM document_jobs WHERE revision_id=$1", [second.revisionId]))
      .rows[0].status,
  ).toBe("failed");
});
it("serializes concurrent revisions, counts quota once, enforces exact file format", async () => {
  const ctx = await owner(),
    view = await upload(ctx);
  await finish();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      addFileRevision(ctx, view.id, {
        fileName: "next.csv",
        bytes: bytes("A,2"),
        expectedRevision: 1,
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "conflict" },
  });
  expect(
    (
      await pool.query("SELECT sum(size_bytes)::int n FROM source_files WHERE workspace_id=$1", [
        ctx.workspaceId,
      ])
    ).rows[0].n,
  ).toBe(bytes().length + bytes("A,2").length);
  await expect(
    addFileRevision(ctx, view.id, { fileName: "next.xlsx", bytes: bytes(), expectedRevision: 2 }),
  ).rejects.toMatchObject({ code: "file_type_mismatch" });
  expect(
    await similarSources(ctx, {
      fileName: "sample.docx",
      title: "CSV 업무",
      sha256: "0".repeat(64),
    }),
  ).toEqual([]);
  expect(
    await similarSources(ctx, {
      fileName: "sample.csv",
      title: "CSV 업무",
      sha256: "0".repeat(64),
    }),
  ).toHaveLength(1);
});
it.each(["failed", "rejected"] as const)(
  "quarantines %s and retry creates a new revision",
  async (status) => {
    const ctx = await owner(),
      view = await upload(ctx),
      job = required(await claimDocumentJob());
    await completeDocumentJob(job, {
      status,
      reason: "안전한 오류 안내",
      snapshot: null,
      coverage: [],
    });
    await expect(fileContent(ctx, view.id, 1)).rejects.toMatchObject({
      code: "document_not_ready",
    });
    await expect(
      saveDraft(ctx, view.revisionId, { ...exampleDraft, references: [] }),
    ).rejects.toMatchObject({ code: "document_not_ready" });
    const retry = await retryDocument(ctx, view.id, 1, 1);
    expect(retry).toMatchObject({ revision: 2, extraction: { status: "queued" } });
    expect((await getSource(ctx, view.id, 1)).extraction?.status).toBe(status);
  },
);
it("requires explicit limited acknowledgement and human provenance", async () => {
  const ctx = await owner(),
    view = await upload(ctx),
    job = required(await claimDocumentJob());
  await completeDocumentJob(job, {
    status: "limited",
    reason: "추출 한도",
    snapshot: null,
    coverage: ["본문 일부"],
  });
  expect((await getFileRevision(ctx, view.id, 1)).questions).toHaveLength(2);
  await expect(draftFromFile(ctx, view.id, 1)).rejects.toMatchObject({
    code: "document_not_ready",
  });
  const draft = await saveDraft(ctx, view.revisionId, {
    ...exampleDraft,
    references: [],
    unknowns: [],
  });
  await expect(
    publishManual(ctx, draft.id, draft.draftRevision, draft.draft.unknowns),
  ).rejects.toMatchObject({ code: "review_required" });
  expect(
    (await publishManual(ctx, draft.id, draft.draftRevision, draft.draft.unknowns, true)).history
      ?.revisions[0]?.resultId,
  ).toBeTruthy();
});
it("keeps old document bodies out of Reader, retrieval, history, and automatic AI inputs", async () => {
  const mail = setupFileMail(),
    { ctx } = await signedInUser(mail);
  workspaces.push(ctx.workspaceId);
  const first = await upload(ctx, "name,value\nA,SECRET_OLD_7391");
  await finish();
  const second = await addFileRevision(ctx, first.id, {
    fileName: "sample.csv",
    bytes: bytes("name,value\nA,SAFE_NEW_7391"),
    expectedRevision: 1,
  });
  await finish();
  const view = await getFileRevision(ctx, first.id, 2),
    q = required(view.questions[0]);
  expect(JSON.stringify(await documentDetails(ctx, first.id, 2))).toContain("SECRET_OLD_7391");
  await answerQuestion(ctx, first.id, 2, q.id, { answer: "검수된 답변" });
  const draft = await saveDraft(ctx, second.revisionId, {
    ...exampleDraft,
    references: [],
    unknowns: [],
  });
  const published = await publishManual(ctx, draft.id, draft.draftRevision, draft.draft.unknowns);
  const reader = await requireSession((await shareWithNewReader(ctx, draft.id)).token);
  await answerQuestion(ctx, first.id, 2, q.id, { answer: "나중 답변" });
  const detail = await getFileRevision(reader, first.id, 2);
  expect(detail.questions[0]?.answer).toBe("검수된 답변");
  const data = [
    detail,
    await getSource(reader, first.id),
    await getManual(reader, draft.id),
    await listFileRevisions(reader, first.id),
    await retrieve(reader, "CSV 업무", draft.id),
    published,
  ];
  expect(JSON.stringify(data)).not.toContain("SECRET_OLD_7391");
  expect(JSON.stringify(data)).not.toContain("SAFE_NEW_7391");
  await expect(documentDetails(reader, first.id, 2)).rejects.toMatchObject({ httpStatus: 403 });
  await expect(documentDetails(await owner(), first.id, 2)).rejects.toMatchObject({
    httpStatus: 404,
  });
  await expect(fileContent(reader, first.id, 1)).rejects.toMatchObject({ httpStatus: 404 });
  expect((await fileContent(reader, first.id, 2)).bytes).toEqual(
    bytes("name,value\nA,SAFE_NEW_7391"),
  );
  const generate = vi.spyOn(ai, "generateFileManual").mockResolvedValue(exampleDraft);
  await draftFromFile(ctx, first.id, 2);
  expect(JSON.stringify(generate.mock.calls)).not.toMatch(/SECRET_OLD_7391|SAFE_NEW_7391/);
  expect(published.history?.revisions[1]).toMatchObject({
    sourceRevisionId: second.revisionId,
    resultId: view.extraction?.resultId,
    questionIds: view.questions.map((q) => q.id),
  });
});

it("blocks a new pending revision from publishing and rejects authorization before parsing", async () => {
  const ctx = await owner(),
    first = await upload(ctx);
  await finish();
  const saved = await saveDraft(ctx, first.revisionId, {
    ...exampleDraft,
    references: [],
    unknowns: [],
  });
  await addFileRevision(ctx, first.id, {
    fileName: "sample.csv",
    bytes: bytes("A,2"),
    expectedRevision: 1,
  });
  const manual = await getManual(ctx, saved.id);
  await expect(
    publishManual(ctx, saved.id, manual.draftRevision, manual.draft.unknowns),
  ).rejects.toMatchObject({ code: "document_not_ready" });
  await expect(
    createFileSource(ctx, { title: "huge", fileName: "large.csv", bytes: new Uint8Array(5242881) }),
  ).rejects.toMatchObject({ httpStatus: 413 });
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [
    ctx.sessionId,
  ]);
  await expect(
    createFileSource(ctx, { title: "invalid", fileName: "invalid.docx", bytes: bytes() }),
  ).rejects.toMatchObject({ httpStatus: 401 });
});
it("POST queues general documents with 202 and downloads original CSV with safe MIME", async () => {
  const { POST } = await import("../../src/app/api/sources/route.ts");
  const { GET } = await import("../../src/app/api/sources/[id]/revisions/[revision]/file/route.ts");
  const session = await createWorkspace(),
    ctx = await requireSession(session.token);
  workspaces.push(ctx.workspaceId);
  const origin = process.env["APP_ORIGIN"] ?? "http://localhost:3200",
    headers = { origin, cookie: `gm_owner=${session.token}` };
  const form = new FormData();
  form.set("title", "CSV 업무");
  form.set("file", new File([bytes()], "file.csv"));
  const response = await POST(
    new Request(`${origin}/api/sources`, { method: "POST", headers, body: form }),
  );
  expect(response.status).toBe(202);
  const view = await response.json();
  await finish();
  const download = await GET(
    new Request(`${origin}/api/sources/${view.id}/revisions/1/file`, { headers }),
    { params: Promise.resolve({ id: view.id, revision: "1" }) },
  );
  expect(download.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  expect(download.headers.get("cache-control")).toBe("private, no-store");
  expect(download.headers.get("content-disposition")).toMatch(/^attachment/);
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes());
});

it.each(["limited", "failed"] as const)(
  "asks what and why changed when previous extraction was %s",
  async (status) => {
    const ctx = await owner();
    const first = await upload(ctx);
    const job = required(await claimDocumentJob());
    await completeDocumentJob(job, {
      status,
      reason: "이전 내용 추출 불가",
      snapshot: null,
      coverage: [],
    });
    const second = await addFileRevision(ctx, first.id, {
      fileName: "sample.csv",
      bytes: bytes("name,value\nA,SECRET_NEW_7391"),
      expectedRevision: 1,
    });
    await finish();
    const detail = await getFileRevision(ctx, first.id, second.revision);
    expect(detail.compareStatus).toBe("limit_exceeded");
    expect(detail.questions).toHaveLength(1);
    expect(detail.questions[0]).toMatchObject({ kind: "change", groupPositions: [] });
    expect(detail.questions[0]?.question).toContain("무엇");
    expect(detail.questions[0]?.question).toContain("이유");
    expect(JSON.stringify(detail.questions)).not.toContain("SECRET_NEW_7391");
  },
);

it("keeps first-version questions and no-change revisions unchanged", async () => {
  const ctx = await owner(),
    first = await upload(ctx);
  await finish();
  expect((await getFileRevision(ctx, first.id, 1)).questions.map((q) => q.kind)).toEqual([
    "purpose",
    "origin",
  ]);
  await addFileRevision(ctx, first.id, {
    fileName: "sample.csv",
    bytes: bytes(),
    expectedRevision: 1,
  });
  await finish();
  const unchanged = await getFileRevision(ctx, first.id, 2);
  expect(unchanged.compareStatus).toBe("no_changes");
  expect(unchanged.questions).toEqual([]);
});
