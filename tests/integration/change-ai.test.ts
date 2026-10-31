import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { setAITransportForTest } from "../../src/lib/ai.ts";
import { pool } from "../../src/lib/db.ts";
import { addFileRevision, createFileSource } from "../../src/lib/file-sources.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`));
let reply: unknown = {};
let delay = 0;
const bodies: string[] = [];
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  bodies.push(body);
  setTimeout(() => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "resp_fixture",
        object: "response",
        created_at: 1,
        status: "completed",
        error: null,
        incomplete_details: null,
        output: [
          {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(reply), annotations: [] }],
          },
        ],
      }),
    );
  }, delay);
});
let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
beforeEach(async () => {
  bodies.length = 0;
  delay = 0;
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("OPENAI_API_KEY", "fixture-key");
  vi.stubEnv("AI_DAILY_LIMIT", "100000");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  setAITransportForTest({ baseURL: `http://127.0.0.1:${address.port}/v1`, timeout: 300 });
});
afterEach(async () => {
  setAITransportForTest(null);
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterAll(async () => pool.end());
async function upload() {
  const { ctx } = await signedInUser(mail);
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  return addFileRevision(ctx, v1.id, {
    fileName: "정산_1030.xlsx",
    bytes: fixture("정산_1030.xlsx"),
    expectedRevision: 1,
  });
}

it("stores AI questions and the version summary", async () => {
  reply = {
    summary: "거래처별 합계 시트를 추가하고 합계에서 음수를 빼도록 바꾼 버전입니다.",
    questions: [
      { groupPositions: [1], question: "합계에 >0 조건이 생겼어요. 반품을 빼려는 건가요?" },
      { groupPositions: [0, 2], question: "새 시트와 값 변경은 어떤 보고를 위한 건가요?" },
    ],
  };
  const v2 = await upload();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).not.toContain("정산_1030.xlsx");
  expect(v2.aiSummary).toBe(reply && (reply as { summary: string }).summary);
  expect(v2.questions.map((q) => [q.source, q.groupPositions])).toEqual([
    ["ai", [1]],
    ["ai", [0, 2]],
  ]);
});
it.each([
  [
    "an unknown group position",
    { summary: "요약", questions: [{ groupPositions: [99], question: "질문" }] },
  ],
  [
    "more than ten questions",
    {
      summary: "요약",
      questions: Array.from({ length: 11 }, () => ({ groupPositions: [0], question: "질문" })),
    },
  ],
])("falls back to rule questions on %s", async (_label, body) => {
  reply = body;
  const v2 = await upload();
  expect(v2.aiSummary).toBeNull();
  expect(v2.questions.every((q) => q.source === "rule")).toBe(true);
  expect(v2.questions).toHaveLength(3);
});
it("falls back when the provider is too slow, and the upload still succeeds", async () => {
  reply = { summary: "요약", questions: [{ groupPositions: [0], question: "질문" }] };
  delay = 1000;
  const v2 = await upload();
  expect(v2.questions.every((q) => q.source === "rule")).toBe(true);
});
it("does not call the provider when AI is off or the daily limit is reached", async () => {
  vi.stubEnv("AI_ENABLED", "false");
  await upload();
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_DAILY_LIMIT", "0");
  await upload();
  expect(bodies).toHaveLength(0);
});
