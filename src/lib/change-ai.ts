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

export function changePrompt(
  _title: string,
  _after: Snapshot,
  _groups: readonly ChangeGroup[],
): ChangePromptInput {
  throw new Error("Task 5");
}
// Returns null whenever the rule questions should be used instead (AI off, failed, slow or invalid).
export async function changeQuestions(
  _ctx: SessionContext,
  _title: string,
  _after: Snapshot,
  _groups: readonly ChangeGroup[],
): Promise<ChangeAiResult | null> {
  if (process.env["AI_ENABLED"] !== "true") return null;
  return null;
}
