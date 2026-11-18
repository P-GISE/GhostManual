import { createServer } from "node:http";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { setAITransportForTest } from "../../src/lib/ai.ts";
import { ask } from "../../src/lib/answers.ts";
import { pool } from "../../src/lib/db.ts";
import { publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource } from "../../src/lib/sources.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
import { shareWithNewReader } from "./mail-helper.ts";

// 고정 응답 서버: 고쳐 쓰기 요청(history가 있음)과 답 요청(candidates가 있음)을 구분해 답한다.
let rewrite: string | null = "업무 계정 발급은 누가 승인하나요?";
const requests: { kind: "rewrite" | "answer"; body: string }[] = [];
const server = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const content =
    z.object({ messages: z.array(z.object({ content: z.string() })) }).parse(JSON.parse(raw))
      .messages[0]?.content ?? "";
  const input = z
    .object({
      history: z.array(z.unknown()).optional(),
      candidates: z.array(z.object({ id: z.uuid() })).optional(),
    })
    .parse(JSON.parse(content));
  const kind = input.history ? "rewrite" : "answer";
  requests.push({ kind, body: content });
  if (kind === "rewrite" && rewrite === null) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "x" } }));
    return;
  }
  const text =
    kind === "rewrite"
      ? { question: rewrite }
      : {
          status: "supported",
          claims: [{ text: "팀 책임자가 승인합니다.", evidenceIds: [input.candidates?.[0]?.id] }],
          procedure: [],
          limitations: [],
        };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: JSON.stringify(text) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
});
beforeEach(async () => {
  requests.length = 0;
  rewrite = "업무 계정 발급은 누가 승인하나요?";
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
  vi.stubEnv("AI_DAILY_LIMIT", "100000");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  setAITransportForTest({ baseURL: `http://127.0.0.1:${address.port}/v1`, timeout: 2000 });
});
afterEach(async () => {
  setAITransportForTest(null);
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterAll(() => pool.end());

async function published() {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  const manual = await saveDraft(owner, source.revisionId, exampleDraft);
  await publishManual(owner, manual.id, 1, exampleDraft.unknowns);
  return { owner, manual };
}
const counter = async (scope: string, kind: string) =>
  (
    await pool.query<{ attempts: number }>(
      "SELECT attempts FROM usage_counters WHERE day=(now() AT TIME ZONE 'UTC')::date AND scope=$1 AND kind=$2",
      [scope, kind],
    )
  ).rows[0]?.attempts ?? 0;

it("rewrites a follow-up from the conversation, searches with it and counts one question", async () => {
  const { owner } = await published();
  const first = await ask(owner, { question: "업무 계정 발급 절차" }, "first-turn");
  expect(first.understoodAs).toBeNull();
  expect(requests.map((r) => r.kind)).toEqual(["answer"]);
  const globalBefore = await counter("global", "all");
  // "그건"만으로는 매뉴얼에서 아무것도 찾지 못한다.
  expect((await ask(owner, { question: "그건 누가 해?" }, "alone-question")).status).toBe(
    "insufficient",
  );
  requests.length = 0;
  const followUp = await ask(
    owner,
    { question: "그건 누가 해?", after: [first.id] },
    "second-turn",
  );
  expect(followUp).toMatchObject({
    question: "그건 누가 해?",
    understoodAs: "업무 계정 발급은 누가 승인하나요?",
    status: "supported",
  });
  expect(requests.map((r) => r.kind)).toEqual(["rewrite", "answer"]);
  // 고쳐 쓰기에는 앞 질문과 답만 가고 매뉴얼 근거는 가지 않는다. 답 요청에는 앞 대화가 가지 않는다.
  expect(requests[0]?.body).toContain("업무 계정 발급 절차");
  expect(requests[0]?.body).not.toContain("candidates");
  expect(requests[1]?.body).toContain("업무 계정 발급은 누가 승인하나요?");
  expect(requests[1]?.body).not.toContain("history");
  expect(await counter(owner.workspaceId, "question")).toBe(2);
  expect((await counter("global", "all")) - globalBefore).toBe(2);
  // 같은 요청 키로 다시 보내면 AI를 부르지 않고 같은 결과를 준다.
  requests.length = 0;
  expect(
    (await ask(owner, { question: "그건 누가 해?", after: [first.id] }, "second-turn")).id,
  ).toBe(followUp.id);
  expect(requests).toHaveLength(0);
});

it("still answers when the rewrite fails by searching with the previous question", async () => {
  const { owner } = await published();
  const first = await ask(owner, { question: "업무 계정 발급 절차" }, "first-turn");
  rewrite = null;
  requests.length = 0;
  const followUp = await ask(
    owner,
    { question: "그건 누가 해?", after: [first.id] },
    "fallback-search",
  );
  expect(followUp.status).toBe("supported");
  expect(followUp.understoodAs).toBeNull();
  expect(requests.map((r) => r.kind)).toEqual(["rewrite", "answer"]);
});

it("ignores question ids from another session and skips the rewrite when AI is off", async () => {
  const { owner, manual } = await published();
  const first = await ask(owner, { question: "업무 계정 발급 절차" }, "first-turn");
  const reader = await requireSession((await shareWithNewReader(owner, manual.id)).token);
  requests.length = 0;
  // 후임자가 작성자의 질문 id를 보내도 앞 대화로 쓰지 않는다.
  const stolen = await ask(reader, { question: "그건 누가 해?", after: [first.id] }, "stolen-ids");
  expect(stolen.status).toBe("insufficient");
  expect(requests).toHaveLength(0);
  vi.stubEnv("AI_ENABLED", "false");
  const off = await ask(
    owner,
    { question: "업무 계정 승인", after: [first.id] },
    "ai-off-question",
  );
  expect(off.status).toBe("unavailable");
  expect(off.understoodAs).toBeNull();
  expect(requests).toHaveLength(0);
});
