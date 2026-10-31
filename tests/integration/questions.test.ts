import { readFile } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import { z } from "zod";
import { ask, getQuestion } from "../../src/lib/answers.ts";
import { pool } from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { retrieve } from "../../src/lib/retrieval.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource, updateSource } from "../../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";

afterAll(async () => {
  await pool.end();
});
async function setup() {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  return { owner, source, manual };
}
it("excludes unpublished, other workspaces and changed sources before ranking", async () => {
  const { owner, source, manual } = await setup();
  expect(await retrieve(owner, "업무 계정")).toEqual([]);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  expect((await retrieve(owner, "업무 계정")).length).toBeGreaterThan(0);
  const other = await requireSession((await createWorkspace()).token);
  expect(await retrieve(other, "업무 계정", manual.id)).toEqual([]);
  await updateSource(
    owner,
    source.id,
    { ...exampleSource, text: exampleSource.text + "\n\n변경된 요청 절차입니다." },
    1,
  );
  expect(await retrieve(owner, "업무 계정")).toEqual([]);
});
it("persists insufficient without provider and unavailable with null confidence and search results", async () => {
  const { owner, manual } = await setup();
  const empty = await ask(owner, { question: "해외출장 환율" }, "empty-request");
  expect(empty.status).toMatch(/^(insufficient|unavailable)$/);
  expect(empty.evidence).toEqual([]);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  process.env["AI_ENABLED"] = "false";
  const answer = await ask(owner, { question: "업무 계정 발급" }, "search-request");
  expect(answer.status).toBe("unavailable");
  expect(answer.confidence).toBeNull();
  expect(answer.insufficientEvidence).toBeNull();
  expect(answer.searchResults.length).toBeGreaterThan(0);
  expect((await ask(owner, { question: "업무 계정 발급" }, "search-request")).id).toBe(answer.id);
  await expect(ask(owner, { question: "다른 질문" }, "search-request")).rejects.toMatchObject({
    code: "idempotency_conflict",
  });
  const other = await requireSession((await createWorkspace()).token);
  await expect(getQuestion(other, answer.id)).rejects.toMatchObject({ code: "not_found" });
});
it("retrieves expected Korean evidence in at least eleven of twelve fixtures and separates absent cases", async () => {
  const data = z
    .object({
      cases: z.array(z.object({ question: z.string(), expected: z.string() })),
      absent: z.array(z.string()),
      injection: z.array(z.string()),
    })
    .parse(
      JSON.parse(await readFile(new URL("../fixtures/evaluation.json", import.meta.url), "utf8")),
    );
  const { owner, manual } = await setup();
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  let found = 0;
  for (const item of data.cases) {
    const evidence = await retrieve(owner, item.question);
    if (evidence.some((candidate) => candidate.quote.includes(item.expected))) found++;
    expect(evidence.length).toBeLessThanOrEqual(6);
    expect(evidence.reduce((sum, item) => sum + item.quote.length, 0)).toBeLessThanOrEqual(12000);
  }
  expect(found).toBeGreaterThanOrEqual(11);
  for (const question of data.absent) expect(await retrieve(owner, question)).toEqual([]);
  for (const question of data.injection)
    expect(
      (await ask(owner, { question }, `injection-${data.injection.indexOf(question)}`)).status,
    ).toMatch(/^(insufficient|unavailable)$/);
});

it("isolates reader question sessions and preserves outdated historical results", async () => {
  const { shareWithNewReader } = await import("./mail-helper.ts");
  const { owner, source, manual } = await setup();
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  const reader = await requireSession((await shareWithNewReader(owner, manual.id)).token);
  const second = await requireSession((await shareWithNewReader(owner, manual.id)).token);
  const own = await ask(owner, { question: "업무 계정" }, "owner-question");
  await expect(getQuestion(reader, own.id)).rejects.toMatchObject({ code: "not_found" });
  const readAnswer = await ask(reader, { question: "업무 계정" }, "reader-question");
  await expect(getQuestion(second, readAnswer.id)).rejects.toMatchObject({ code: "not_found" });
  expect((await getQuestion(owner, readAnswer.id)).id).toBe(readAnswer.id);
  await updateSource(
    owner,
    source.id,
    { ...exampleSource, text: exampleSource.text + "\n\n최신 업무 절차 확인이 필요합니다." },
    1,
  );
  expect((await getQuestion(owner, own.id)).isOutdated).toBe(true);
});
it("stores provider-validated evidence snapshots and rejects a version changed during response generation", async () => {
  const { createServer } = await import("node:http");
  const { setAITransportForTest } = await import("../../src/lib/ai.ts");
  const { getEvidence } = await import("../../src/lib/evidence.ts");
  const { owner, manual } = await setup();
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  let changeVersion = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = z
      .object({ messages: z.array(z.object({ content: z.string() })) })
      .parse(JSON.parse(Buffer.concat(chunks).toString()));
    const data = z
      .object({ candidates: z.array(z.object({ id: z.uuid() })) })
      .parse(JSON.parse(body.messages[0]?.content ?? ""));
    const id = data.candidates[0]?.id;
    if (changeVersion)
      await pool.query("UPDATE manuals SET needs_review=true WHERE id=$1", [manual.id]);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "partial",
              claims: [{ text: "승인을 확인합니다.", evidenceIds: [id] }],
              procedure: [],
              limitations: ["상충하는 승인 규칙은 담당자 확인이 필요합니다."],
            }),
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server address");
  process.env["AI_ENABLED"] = "true";
  process.env["ANTHROPIC_API_KEY"] = "fixture-only";
  setAITransportForTest({ baseURL: `http://127.0.0.1:${address.port}/v1` });
  try {
    const answer = await ask(owner, { question: "업무 계정 승인" }, "supported-fixture");
    expect(answer.status).toBe("partial");
    const evidence = answer.evidence[0];
    expect(evidence).toBeDefined();
    if (evidence) expect((await getEvidence(owner, evidence.id)).quote).toBe(evidence.quote);
    changeVersion = true;
    await expect(
      ask(owner, { question: "업무 계정 승인" }, "changed-fixture"),
    ).rejects.toMatchObject({ code: "version_changed" });
    expect((await getQuestion(owner, answer.id)).isOutdated).toBe(true);
  } finally {
    setAITransportForTest(null);
    process.env["AI_ENABLED"] = "false";
    delete process.env["ANTHROPIC_API_KEY"];
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
