import { createServer } from "node:http";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAITransportForTest } from "../../src/lib/ai.ts";
import { pool } from "../../src/lib/db.ts";
import {
  getTemplate,
  listTemplates,
  registerTemplate,
  runTemplateJob,
} from "../../src/lib/template-extraction.ts";
import { readTemplate, updateTemplate } from "../../src/lib/templates.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { setupFileMail, signedInUser } from "./mail-helper.ts";

let reply: unknown = {};
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
      content: [{ type: "text", text: JSON.stringify(reply) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
});
beforeEach(async () => {
  bodies.length = 0;
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
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
afterAll(() => pool.end());

async function reviewed(ctx: Parameters<typeof registerTemplate>[0], name: string) {
  const template = await registerTemplate(
    ctx,
    name,
    pack(docx(wp("업무 목적") + wp("홍길동 010-0000-0000") + wp("완료 기준"))),
  );
  while (await runTemplateJob());
  return template.id;
}
const items = [
  { name: "업무 목적", guide: "", kind: "text" as const },
  { name: "완료 기준", guide: "끝났다고 볼 조건", kind: "list" as const },
];

it("confirms items, keeps their ids and manages the single default template", async () => {
  const mail = setupFileMail();
  const { ctx } = await signedInUser(mail);
  const other = await signedInUser(mail);
  const first = await reviewed(ctx, "first.docx");
  const second = await reviewed(ctx, "second.docx");
  await expect(updateTemplate(ctx, first, { isDefault: true })).rejects.toMatchObject({
    httpStatus: 409,
  });
  await expect(updateTemplate(other.ctx, first, { items })).rejects.toMatchObject({
    httpStatus: 404,
  });
  await expect(
    updateTemplate(ctx, first, { items: Array.from({ length: 31 }, () => items[0]) as never }),
  ).rejects.toThrow();
  const ready = await updateTemplate(ctx, first, { items, name: "인계서" });
  expect(ready).toMatchObject({ status: "ready", isDefault: true, name: "인계서" });
  const saved = z(ready["items"]);
  expect(saved.map((entry) => entry.name)).toEqual(["업무 목적", "완료 기준"]);
  expect(new Set(saved.map((entry) => entry.id)).size).toBe(2);
  // 다시 확정해도 기존 항목의 id는 그대로다.
  const again = z(
    (
      await updateTemplate(ctx, first, {
        items: [...saved, { name: "비고", guide: "", kind: "text" }],
      })
    )["items"],
  );
  expect(again.slice(0, 2).map((entry) => entry.id)).toEqual(saved.map((entry) => entry.id));
  expect(await updateTemplate(ctx, second, { items })).toMatchObject({ isDefault: false });
  expect(await updateTemplate(ctx, second, { isDefault: true })).toMatchObject({ isDefault: true });
  expect((await listTemplates(ctx)).filter((template) => template["isDefault"])).toHaveLength(1);
  expect(await getTemplate(ctx, first)).toMatchObject({ isDefault: false, fileName: "first.docx" });
});

it("sends only the checked candidates to AI and counts five reads a day", async () => {
  const { ctx } = await signedInUser(setupFileMail());
  const id = await reviewed(ctx, "form.docx");
  const template = await getTemplate(ctx, id);
  const ids = (
    template["extraction"] as { candidates: { candidateId: string; name: string }[] }
  ).candidates
    .filter((candidate) => !candidate.name.includes("홍길동"))
    .map((candidate) => candidate.candidateId);
  reply = {
    items: [
      { name: "업무 목적", guide: "", kind: "text", from: [1] },
      { name: "지어낸 항목", guide: "", kind: "text", from: [9] },
    ],
  };
  expect(await readTemplate(ctx, id, ids)).toEqual({
    items: [{ name: "업무 목적", guide: "", kind: "text" }],
  });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain("완료 기준");
  expect(bodies[0]).not.toContain("홍길동");
  expect(bodies[0]).not.toContain("form.docx");
  expect((await getTemplate(ctx, id))["status"]).toBe("review");
  await expect(readTemplate(ctx, id, ["body/none:0"])).rejects.toMatchObject({ httpStatus: 422 });
  expect(bodies).toHaveLength(1);
  for (let count = 0; count < 4; count++) await readTemplate(ctx, id, ids);
  await expect(readTemplate(ctx, id, ids)).rejects.toMatchObject({ httpStatus: 429 });
  expect(bodies).toHaveLength(5);
  vi.stubEnv("AI_ENABLED", "false");
  await expect(readTemplate(ctx, id, ids)).rejects.toMatchObject({ code: "ai_disabled" });
});

function z(value: unknown) {
  return value as { id: string; name: string; guide: string; kind: "text" | "list" }[];
}
