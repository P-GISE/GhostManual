import { createServer } from "node:http";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAITransportForTest } from "../../src/lib/ai.ts";
import { pool } from "../../src/lib/db.ts";
import { generateDraft } from "../../src/lib/generation.ts";
import { getManual, publishManual, saveDraft } from "../../src/lib/manuals.ts";
import { retrieve } from "../../src/lib/retrieval.ts";
import type { TemplateDraft } from "../../src/lib/schemas.ts";
import { createSource } from "../../src/lib/sources.ts";
import {
  deleteTemplate,
  registerTemplate,
  runTemplateJob,
} from "../../src/lib/template-extraction.ts";
import { updateTemplate } from "../../src/lib/templates.ts";
import { newId } from "../../src/lib/types.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { exampleDraft, exampleSource } from "../fixtures/manual-example.ts";
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

type Item = { id: string; name: string; guide: string; kind: "text" | "list" };
async function setup() {
  const { ctx } = await signedInUser(setupFileMail());
  const registered = await registerTemplate(ctx, "인계서.docx", pack(docx(wp("인계 사유"))));
  while (await runTemplateJob());
  const template = await updateTemplate(ctx, registered.id, {
    items: [
      { name: "인계 사유", guide: "왜 넘기는지", kind: "text" },
      { name: "처리 절차", guide: "", kind: "list" },
      { name: "비고", guide: "", kind: "text" },
    ],
  });
  const source = await createSource(ctx, exampleSource);
  const items = template["items"] as Item[];
  const draft = (fill: Record<string, string | string[] | "na">): TemplateDraft => ({
    title: "계정 발급 인계",
    template: { id: registered.id, name: "인계서.docx" },
    sections: items.map((item) => {
      const value = fill[item.name];
      return {
        ...item,
        text: typeof value === "string" && value !== "na" ? value : null,
        items: Array.isArray(value) ? value : [],
        state: value === "na" ? "na" : "empty",
        by: "human",
      };
    }),
    unknowns: [],
    references: [],
  });
  return { ctx, source, items, draft, templateId: registered.id };
}

it("publishes a template manual only when no item is left empty and keeps it after the template is deleted", async () => {
  const { ctx, source, items, draft, templateId } = await setup();
  const steps = items[1]?.id;
  const saved = await saveDraft(ctx, source.revisionId, {
    ...draft({ "처리 절차": ["팀 책임자의 승인을 확인합니다."] }),
    references: [{ paragraphId: "p2", quote: "팀 책임자의 승인을 확인", field: `${steps}.0` }],
  });
  // 상태는 내용에서 다시 정해진다.
  expect("sections" in saved.draft && saved.draft.sections.map((s) => s.state)).toEqual([
    "empty",
    "filled",
    "empty",
  ]);
  await expect(publishManual(ctx, saved.id, 1, [])).rejects.toMatchObject({
    httpStatus: 422,
    message: "비어 있는 항목: 인계 사유, 비고. 초안 수정에서 채운 뒤 게시하세요.",
  });
  await expect(
    saveDraft(
      ctx,
      source.revisionId,
      {
        ...draft({}),
        references: [{ paragraphId: "p2", quote: "팀 책임자의 승인을 확인", field: `${steps}.0` }],
      },
      1,
    ),
  ).rejects.toMatchObject({ code: "invalid_reference" });
  const none = await saveDraft(
    ctx,
    source.revisionId,
    draft({ "인계 사유": "na", "처리 절차": "na", 비고: "na" }),
    1,
  );
  await expect(publishManual(ctx, none.id, 2, [])).rejects.toMatchObject({
    message: "한 항목 이상 내용을 채운 뒤 게시하세요.",
  });
  const ready = await saveDraft(
    ctx,
    source.revisionId,
    draft({ "인계 사유": "담당자 이동", "처리 절차": ["승인 확인 뒤 계정 발급"], 비고: "na" }),
    2,
  );
  const published = await publishManual(ctx, ready.id, 3, []);
  expect(published.version).toBe(1);
  // 후임자 답변의 근거로 양식 항목의 내용이 잡힌다.
  expect(
    (await retrieve(ctx, "담당자 이동")).some(
      (candidate) => candidate.kind === "manual" && candidate.quote === "담당자 이동",
    ),
  ).toBe(true);
  await deleteTemplate(ctx, templateId);
  const kept = await getManual(ctx, ready.id);
  expect("sections" in kept.draft && kept.draft.sections).toHaveLength(3);
  expect(kept.published?.content).toMatchObject({ template: { name: "인계서.docx" } });
});

it("drafts with the default template, leaves items without evidence empty and can skip the template", async () => {
  const { ctx, source, items, templateId } = await setup();
  reply = {
    title: "업무 계정 발급",
    sections: [
      { id: items[0]?.id, text: "신입 구성원 입사", items: [] },
      { id: items[1]?.id, text: null, items: ["팀 책임자의 승인을 확인합니다."] },
      { id: "made-up", text: "지어낸 항목", items: [] },
    ],
    unknowns: ["비고에 쓸 내용이 원본에 없습니다."],
    references: [
      { paragraphId: "p2", quote: "팀 책임자의 승인을 확인", field: `${items[1]?.id}.0` },
    ],
  };
  const generated = await generateDraft(ctx, {
    sourceId: source.id,
    expectedRevision: 1,
    key: newId(),
  });
  if (!("manual" in generated)) throw new Error("expected a manual");
  const draft = generated.manual.draft;
  if (!("sections" in draft)) throw new Error("expected the template shape");
  expect(draft.template).toEqual({ id: templateId, name: "인계서.docx" });
  expect(draft.sections.map((s) => [s.name, s.state, s.by])).toEqual([
    ["인계 사유", "filled", "ai"],
    ["처리 절차", "filled", "ai"],
    ["비고", "empty", "ai"],
  ]);
  expect(JSON.stringify(draft)).not.toContain("지어낸 항목");
  // AI에는 확정 항목의 id·이름·작성 안내·형태만 더 보낸다.
  expect(bodies[0]).toContain("왜 넘기는지");
  expect(bodies[0]).not.toContain("인계서.docx");
  reply = exampleDraft;
  const plain = await generateDraft(ctx, {
    sourceId: source.id,
    expectedRevision: 1,
    key: newId(),
    templateId: null,
  });
  expect("manual" in plain && "purpose" in plain.manual.draft).toBe(true);
  await expect(
    generateDraft(ctx, {
      sourceId: source.id,
      expectedRevision: 1,
      key: newId(),
      templateId: newId(),
    }),
  ).rejects.toMatchObject({ httpStatus: 404 });
});
