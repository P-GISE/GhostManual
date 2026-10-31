import { z } from "zod";
import { generate, instructions } from "./ai.ts";
import { reserveChangeAi } from "./operations.ts";
import type { SessionContext } from "./types.ts";
import type { ChangeGroup, Snapshot } from "./xlsx/index.ts";

export type ChangePromptInput = {
  title: string;
  sheets: { name: string; rows: number; cols: number; headers: string[] }[];
  changes: {
    position: number;
    kind: string;
    sheet: string | null;
    range: string | null;
    count?: number;
    before?: string;
    after?: string;
  }[];
};
export type ChangeAiResult = {
  summary: string;
  questions: { groupPositions: number[]; question: string }[];
};

// Structure only: sheet sizes, first-row headers, formulas and change locations. Cell values never leave.
export function changePrompt(
  title: string,
  after: Snapshot,
  groups: readonly ChangeGroup[],
): ChangePromptInput {
  return {
    title: title.slice(0, 120),
    sheets: after.sheets.map((sheet) => ({
      name: sheet.name.slice(0, 40),
      rows: sheet.rows,
      cols: sheet.cols,
      headers: Object.entries(sheet.cells)
        .filter(([address]) => /^[A-Z]+1$/.test(address))
        .slice(0, 30)
        .map(([, cell]) => String(cell.v ?? "").slice(0, 40)),
    })),
    changes: groups.map((group, position) => {
      const change: ChangePromptInput["changes"][number] = {
        position,
        kind: group.kind,
        sheet: group.sheet?.slice(0, 40) ?? null,
        range: group.range,
      };
      const { count, before, after } = group.summary;
      if (typeof count === "number") change.count = count;
      if (typeof before === "string") change.before = before.slice(0, 200);
      if (typeof after === "string") change.after = after.slice(0, 200);
      return change;
    }),
  };
}
const outputSchema = z.object({
  summary: z.string().min(1).max(500),
  questions: z
    .array(
      z.object({
        groupPositions: z.array(z.number().int()).min(1),
        question: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(10),
});
const prompt =
  " 엑셀 파일의 이전 버전과 새 버전을 비교한 변경 목록입니다. 인수인계를 위해 작성자에게 물을 질문과 이번 버전 요약을 만드세요." +
  " 관찰한 변경만 근거로 묻고 의도를 단정하지 말고 '~하려는 건가요?'처럼 확인하는 말투로, 엑셀 기능 이름(시트·수식·필터)을 써서 한국어로 짧게 쓰세요." +
  " 비슷한 변경은 한 질문으로 묶고 질문은 10개 이하로 하세요. groupPositions에는 질문이 다루는 변경의 position만 넣으세요. 요약은 1~2문장입니다.";

// Returns null whenever the rule questions should be used instead (AI off, failed, slow or invalid).
export async function changeQuestions(
  ctx: SessionContext,
  title: string,
  after: Snapshot,
  groups: readonly ChangeGroup[],
): Promise<ChangeAiResult | null> {
  if (process.env["AI_ENABLED"] !== "true" || !groups.length) return null;
  try {
    if (!(await reserveChangeAi(ctx))) return null;
    const result = await generate(
      outputSchema,
      "change_questions",
      changePrompt(title, after, groups),
      20000,
      4000,
      instructions + prompt,
      "low",
    );
    if (result.questions.some((q) => q.groupPositions.some((p) => p < 0 || p >= groups.length)))
      return null;
    return result;
  } catch {
    return null;
  }
}
