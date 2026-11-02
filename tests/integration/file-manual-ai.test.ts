import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { updateProfile } from "../../src/lib/accounts.ts";
import { setAITransportForTest } from "../../src/lib/ai.ts";
import { pool } from "../../src/lib/db.ts";
import {
  addFileRevision,
  answerQuestion,
  createFileSource,
  getFileRevision,
} from "../../src/lib/file-sources.ts";
import { generateDraft } from "../../src/lib/generation.ts";
import { newId } from "../../src/lib/types.ts";
import { exampleDraft } from "../fixtures/manual-example.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`));
const bodies: string[] = [];
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  bodies.push(body);
  response.writeHead(200, { "content-type": "application/json" });
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
            ...exampleDraft,
            title: "월간 정산 마감",
            unknowns: ["담당 주기"],
          }),
        },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
});
let mail = "";
beforeAll(() => {
  mail = setupFileMail();
});
beforeEach(async () => {
  bodies.length = 0;
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
  vi.stubEnv("AI_DAILY_LIMIT", "100000");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  setAITransportForTest({ baseURL: `http://127.0.0.1:${address.port}/v1` });
});
afterEach(async () => {
  setAITransportForTest(null);
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterAll(async () => pool.end());

it("drafts a manual for a workbook from its structure and answers, never its cells", async () => {
  const { ctx } = await signedInUser(mail);
  await updateProfile(ctx, { name: "박효민", department: "재무팀" });
  const v1 = await createFileSource(ctx, {
    title: "월간 정산",
    fileName: "정산_1029.xlsx",
    bytes: fixture("정산_1029.xlsx"),
  });
  const [purpose] = v1.questions;
  if (!purpose) throw new Error("expected a base question");
  await answerQuestion(ctx, v1.id, 1, purpose.id, { answer: "매달 거래처 정산 금액을 맞춥니다." });
  vi.stubEnv("AI_ENABLED", "false");
  const v2 = await addFileRevision(ctx, v1.id, {
    fileName: "정산_1030.xlsx",
    bytes: fixture("정산_1030.xlsx"),
    expectedRevision: 1,
  });
  vi.stubEnv("AI_ENABLED", "true");

  const result = await generateDraft(ctx, { sourceId: v1.id, expectedRevision: 2, key: newId() });
  if (!("manual" in result)) throw new Error("expected a finished draft");
  const sent = bodies.join("");
  expect(sent).toContain("매달 거래처 정산 금액을 맞춥니다.");
  expect(sent).toContain("SUMIF");
  const cell = (await getFileRevision(ctx, v1.id, 2)).preview[0]?.cells[1]?.[0];
  expect(typeof cell).toBe("string");
  expect(sent).not.toContain(String(cell));
  expect(sent).not.toContain("박효민");
  expect(sent).not.toContain("재무팀");
  expect(sent).not.toContain("정산_1030.xlsx");

  expect(result.manual.provenance).toBe("ai");
  expect(result.manual.sourceRevisionId).toBe(v2.revisionId);
  expect(result.manual.draft.references).toEqual([]);
  expect(result.manual.draft.unknowns).toEqual([
    "담당 주기",
    ...v1.questions.slice(1).map((q) => `[v1 확인 필요] ${q.question}`),
    ...v2.questions.map((q) => `[v2 확인 필요] ${q.question}`),
  ]);
});
