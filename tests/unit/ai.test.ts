import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateAnswer, generateManual, setAITransportForTest } from "../../src/lib/ai.ts";
import { RevisionIdSchema, SourceIdSchema } from "../../src/lib/types.ts";

const id = randomUUID();
const source = {
  id: SourceIdSchema.parse(id),
  revisionId: RevisionIdSchema.parse(randomUUID()),
  revision: 1,
  title: "발급",
  text: "승인 후 계정을 발급합니다.".repeat(8),
  createdAt: new Date(),
  kind: "text" as const,
  fileType: null,
  uploadedByName: null,
  uploadedByDepartment: null,
};
const draft = {
  title: "발급",
  purpose: null,
  trigger: null,
  cadence: null,
  ownerRole: null,
  resources: [],
  systems: [],
  steps: ["계정을 발급합니다."],
  warnings: [],
  exceptions: [],
  completion: null,
  unknowns: [],
  references: [{ paragraphId: "p1", quote: "승인 후 계정을 발급합니다.", field: "steps.0" }],
};
const candidate = {
  id,
  manualId: randomUUID(),
  manualVersionId: randomUUID(),
  sourceId: source.id,
  sourceRevisionId: source.revisionId,
  paragraphId: "p1",
  quote: source.text,
  title: source.title,
  kind: "source" as const,
  version: 1,
};
let server: Server;
let calls = 0;
let request: unknown;
let payload: unknown;
let httpStatus = 200;
let stall = false;
function response(value: unknown, text = JSON.stringify(value)) {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}
beforeEach(async () => {
  calls = 0;
  request = undefined;
  httpStatus = 200;
  stall = false;
  payload = response(draft);
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
  server = createServer(async (req, res) => {
    calls++;
    let body = "";
    for await (const chunk of req) body += String(chunk);
    request = JSON.parse(body);
    if (stall) return;
    res.writeHead(httpStatus, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture address unavailable");
  setAITransportForTest({ baseURL: `http://127.0.0.1:${address.port}/v1` });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setAITransportForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("makes zero calls when disabled", async () => {
  vi.stubEnv("AI_ENABLED", "false");
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_disabled" });
  expect(calls).toBe(0);
});
it("sends strict bounded private manual generation", async () => {
  expect(await generateManual(source)).toEqual(draft);
  expect(request).toMatchObject({
    model: "claude-sonnet-5-5",
    max_tokens: 16000,
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema" } },
  });
});
it.each(["quote", "field", "paragraph"])("rejects invalid manual %s", async (fault) => {
  payload = response({
    ...draft,
    references: [
      {
        paragraphId: fault === "paragraph" ? "p2" : "p1",
        quote: fault === "quote" ? "없는 원문" : source.text,
        field: fault === "field" ? "secret" : "steps.0",
      },
    ],
  });
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_invalid_evidence" });
});
it("accepts claims using supplied candidate IDs", async () => {
  payload = response({
    status: "supported",
    claims: [{ text: "발급합니다.", evidenceIds: [id] }],
    procedure: [],
    limitations: [],
  });
  expect((await generateAnswer([candidate], "발급 방법?")).status).toBe("supported");
  expect(z.object({ max_tokens: z.number() }).parse(request).max_tokens).toBe(8000);
});
it("rejects invented candidate IDs", async () => {
  payload = response({
    status: "supported",
    claims: [{ text: "발급", evidenceIds: [randomUUID()] }],
    procedure: [],
    limitations: [],
  });
  await expect(generateAnswer([candidate], "발급?")).rejects.toMatchObject({
    code: "ai_invalid_evidence",
  });
});
it("distinguishes refusal", async () => {
  payload = { ...response(draft, ""), content: [], stop_reason: "refusal" };
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_refused" });
});
it("distinguishes incomplete output", async () => {
  payload = { ...response(draft), stop_reason: "max_tokens" };
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_incomplete" });
});
it("rejects invalid JSON", async () => {
  payload = response(draft, "{bad");
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_invalid_output" });
});
it("does not retry provider errors", async () => {
  httpStatus = 500;
  payload = { type: "error", error: { type: "api_error", message: "fixture" } };
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_provider_error" });
  expect(calls).toBe(1);
});
it("does not retry timed out requests", async () => {
  stall = true;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture address unavailable");
  setAITransportForTest({ baseURL: `http://127.0.0.1:${address.port}/v1`, timeout: 30 });
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_timeout" });
  expect(calls).toBe(1);
});
it("rejects fixture configuration outside test", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => setAITransportForTest({ baseURL: "http://127.0.0.1" })).toThrow();
});

it("makes zero calls when the key is missing", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_missing_key" });
  expect(calls).toBe(0);
});
it("distinguishes provider quota errors without retry", async () => {
  httpStatus = 429;
  payload = { type: "error", error: { type: "rate_limit_error", message: "fixture" } };
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_rate_limit" });
  expect(calls).toBe(1);
});
it("rejects schema-invalid output", async () => {
  payload = response({ title: "missing required fields" });
  await expect(generateManual(source)).rejects.toMatchObject({ code: "ai_invalid_output" });
});
