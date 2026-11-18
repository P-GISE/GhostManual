import { z } from "zod";
import { generate, instructions } from "./ai.ts";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { reserveTemplateAi } from "./operations.ts";
import { assertTemplateOwner, getTemplate } from "./template-extraction.ts";
import { newId, type SessionContext } from "./types.ts";

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !value.includes("\0"));
const item = { name: text(1, 80), guide: text(0, 500), kind: z.enum(["text", "list"]) };
export const TemplateChangeSchema = z.strictObject({
  name: text(1, 255).optional(),
  items: z
    .array(z.strictObject({ id: text(1, 40).optional(), ...item }))
    .min(1)
    .max(30)
    .optional(),
  isDefault: z.boolean().optional(),
});
export type TemplateChange = z.infer<typeof TemplateChangeSchema>;

const missing = () => new AppError("not_found", 404, "양식을 찾을 수 없습니다.");
export async function updateTemplate(ctx: SessionContext, id: string, input: TemplateChange) {
  const change = TemplateChangeSchema.parse(input);
  await transaction(async (db) => {
    await assertTemplateOwner(db, ctx);
    // 등록·삭제·추출 워커와 같은 순서로 문서함 행을 먼저 잠근다.
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [ctx.workspaceId]);
    const found = await db.query<{ status: string }>(
      "SELECT status FROM manual_templates WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
      [ctx.workspaceId, id],
    );
    let status = found.rows[0]?.status;
    if (!status) throw missing();
    if (change.name)
      await db.query("UPDATE manual_templates SET name=$2 WHERE id=$1", [id, change.name]);
    if (change.items) {
      if (status === "reading")
        throw new AppError("conflict", 409, "양식을 읽는 중입니다. 끝난 뒤 다시 시도하세요.");
      const used = new Set<string>();
      const items = change.items.map((entry) => {
        // 이미 만든 매뉴얼이 가리키는 id는 유지하고, 새 항목과 겹친 id에만 새로 붙인다.
        const itemId = entry.id && !used.has(entry.id) ? entry.id : newId().slice(0, 8);
        used.add(itemId);
        return { ...entry, id: itemId };
      });
      const hasDefault = await db.query(
        "SELECT 1 FROM manual_templates WHERE workspace_id=$1 AND is_default",
        [ctx.workspaceId],
      );
      await db.query(
        "UPDATE manual_templates SET items=$2,status='ready',is_default=is_default OR $3 WHERE id=$1",
        [id, JSON.stringify(items), !hasDefault.rowCount],
      );
      status = "ready";
    }
    if (change.isDefault) {
      if (status !== "ready")
        throw new AppError("conflict", 409, "항목을 확정한 양식만 기본으로 지정할 수 있습니다.");
      await db.query(
        "UPDATE manual_templates SET is_default=false WHERE workspace_id=$1 AND is_default AND id<>$2",
        [ctx.workspaceId, id],
      );
    }
    if (change.isDefault !== undefined)
      await db.query("UPDATE manual_templates SET is_default=$2 WHERE id=$1", [
        id,
        change.isDefault,
      ]);
  });
  return getTemplate(ctx, id);
}

const ReadOutputSchema = z.object({
  items: z.array(z.object({ ...item, from: z.array(z.number().int()) })).max(30),
});
// 담당자가 체크한 후보의 글과 요청 안에서만 쓰는 번호만 AI로 보낸다. 결과는 저장하지 않는다.
export async function readTemplate(ctx: SessionContext, id: string, candidateIds: string[]) {
  const ids = z.array(z.string().min(1).max(300)).min(1).max(200).parse(candidateIds);
  const template = await getTemplate(ctx, id);
  const candidates = z
    .object({ candidates: z.array(z.object({ candidateId: z.string(), name: z.string() })) })
    .nullable()
    .parse(template["extraction"])?.candidates;
  const chosen = ids.map((candidateId) => candidates?.find((c) => c.candidateId === candidateId));
  if (new Set(ids).size !== ids.length || chosen.some((c) => !c))
    throw new AppError("invalid_input", 422, "선택한 후보를 다시 확인하세요.");
  if (process.env["AI_ENABLED"] !== "true")
    throw new AppError("ai_disabled", 503, "AI가 비활성화되어 있습니다.");
  if (!(await reserveTemplateAi(ctx)))
    throw new AppError(
      "ai_limit",
      429,
      "AI 항목 정리를 지금 쓸 수 없습니다(하루 5회 한도 또는 AI 사용 제한).",
    );
  const output = await generate(
    ReadOutputSchema,
    "template_read",
    { candidates: chosen.map((candidate, index) => ({ n: index + 1, text: candidate?.name })) },
    45000,
    8000,
    `${instructions} candidates는 회사 인수인계 양식에서 꺼낸 글 조각입니다. 매뉴얼에서 채울 항목 목록으로 정리하세요. 제목, 번호가 붙은 줄, 표의 머리 칸을 항목으로 보세요. 결재란, 기관명, 날짜, 서명란과 이미 작성된 값으로 보이는 조각은 빼세요. 괄호 설명이나 작성 요령은 그 항목의 guide에 넣으세요. 여러 줄을 나열하는 항목은 kind를 list로, 그 밖은 text로 하세요. 받은 조각에 없는 항목을 만들지 말고, 항목마다 근거가 된 조각의 n을 from에 적으세요.`,
  );
  return {
    items: output.items
      .filter((entry) => entry.from.some((n) => n >= 1 && n <= chosen.length))
      .map(({ name, guide, kind }) => ({ name, guide, kind })),
  };
}
