import { createServer, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAITransportForTest } from "../../src/lib/ai.ts";
import { pool } from "../../src/lib/db.ts";
import { generateDraft } from "../../src/lib/generation.ts";
import { listManuals, saveDraft } from "../../src/lib/manuals.ts";
import { createWorkspace, requireSession } from "../../src/lib/session.ts";
import { createSource, updateSource } from "../../src/lib/sources.ts";
import { newId } from "../../src/lib/types.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";

let calls = 0;
let status = 200;
let pending: ServerResponse | undefined;
let arrived: () => void = () => {};
const server = createServer(async (request, response) => {
  for await (const _chunk of request) {
    /* Consume the SDK request before signalling the test. */
  }
  calls++;
  pending = response;
  arrived();
});
function release() {
  if (!pending) throw new Error("Provider request has not arrived");
  pending.writeHead(status, { "content-type": "application/json" });
  pending.end(
    JSON.stringify(
      status === 200
        ? {
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
                content: [
                  { type: "output_text", text: JSON.stringify(exampleDraft), annotations: [] },
                ],
              },
            ],
          }
        : { error: { message: "fixture", type: "server_error" } },
    ),
  );
}
beforeEach(async () => {
  calls = 0;
  status = 200;
  pending = undefined;
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("OPENAI_API_KEY", "fixture-key");
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
async function setup() {
  const owner = await requireSession((await createWorkspace()).token);
  const source = await createSource(owner, exampleSource);
  const input = { sourceId: source.id, expectedRevision: 1, key: newId() };
  return { owner, source, input };
}
it("coalesces an in-flight duplicate and replays completion without another provider request", async () => {
  const { owner, input } = await setup();
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const first = generateDraft(owner, input);
  await received;
  const duplicate = await generateDraft(owner, input);
  expect(duplicate).toMatchObject({ processing: true });
  expect(calls).toBe(1);
  release();
  const completed = await first;
  expect(await generateDraft(owner, input)).toEqual(completed);
  expect(calls).toBe(1);
  expect(await listManuals(owner)).toHaveLength(1);
});
it("rejects a provider result whose source changed while the model was running", async () => {
  const { owner, source, input } = await setup();
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const outcome = expect(generateDraft(owner, input)).rejects.toMatchObject({ httpStatus: 409 });
  await received;
  await updateSource(
    owner,
    source.id,
    { ...exampleSource, text: exampleSource.text + "\n\n변경된 업무 절차" },
    1,
  );
  release();
  await outcome;
  expect(await listManuals(owner)).toHaveLength(0);
  const operation = await pool.query<{ status: string; error_code: string }>(
    "SELECT status,error_code FROM operation_requests WHERE session_id=$1 AND key=$2",
    [owner.sessionId, input.key],
  );
  expect(operation.rows[0]).toMatchObject({ status: "failed", error_code: "conflict" });
});
it("counts provider failure once and replays the failed key without retry", async () => {
  const { owner, input } = await setup();
  status = 500;
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const outcome = expect(generateDraft(owner, input)).rejects.toMatchObject({
    code: "ai_provider_error",
  });
  await received;
  release();
  await outcome;
  await expect(generateDraft(owner, input)).rejects.toMatchObject({ code: "ai_provider_error" });
  expect(calls).toBe(1);
  const usage = await pool.query<{ attempts: number }>(
    "SELECT attempts FROM usage_counters WHERE scope=$1 AND kind='generate' AND day=(now() AT TIME ZONE 'UTC')::date",
    [owner.workspaceId],
  );
  expect(usage.rows[0]?.attempts).toBe(1);
  expect(await listManuals(owner)).toHaveLength(0);
});
it("preserves a human draft edited while the provider is running", async () => {
  const { owner, source, input } = await setup();
  const original = await saveDraft(owner, source.revisionId, exampleDraft);
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const outcome = expect(generateDraft(owner, input)).rejects.toMatchObject({ httpStatus: 409 });
  await received;
  await saveDraft(
    owner,
    source.revisionId,
    { ...exampleDraft, title: "담당자가 수정한 초안" },
    original.draftRevision,
  );
  release();
  await outcome;
  const current = await listManuals(owner);
  expect(current[0]?.draft.title).toBe("담당자가 수정한 초안");
  expect(current[0]?.draftRevision).toBe(2);
  expect(current[0]?.provenance).toBe("human");
});
