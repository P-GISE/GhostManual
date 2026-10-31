import { describe, expect, it } from "vitest";
import { buildQuestions } from "../../src/lib/xlsx/questions.ts";
import type { ChangeGroup } from "../../src/lib/xlsx/types.ts";

function groups(count: number): ChangeGroup[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "values_changed",
    sheet: "원본",
    range: `A${index + 1}`,
    summary: { count: 1 },
  }));
}

describe("buildQuestions", () => {
  it("returns no questions when comparison has no changes", () => {
    expect(buildQuestions([], false)).toEqual([]);
  });
  it("covers all ten groups individually and collapses only overflow", () => {
    expect(buildQuestions(groups(10), false)).toHaveLength(10);
    expect(buildQuestions(groups(10), false).every((question) => question.kind === "change")).toBe(
      true,
    );
    const questions = buildQuestions(groups(12), false);
    expect(questions).toHaveLength(10);
    expect(questions[9]).toMatchObject({ kind: "other", groupIndexes: [9, 10, 11] });
    expect(questions[9]?.question).toContain("3건");
  });
  it("uses short Korean prompts for every change kind without leaking scalar values", () => {
    const kinds = [
      "sheet_added",
      "sheet_removed",
      "formula_added",
      "formula_changed",
      "formula_removed",
      "filter_changed",
      "names_changed",
      "size_changed",
      "values_changed",
    ] as const;
    const changes = kinds.map(
      (kind): ChangeGroup => ({
        kind,
        sheet: "원본",
        range: "A1:B2",
        summary: { count: 2, before: "SECRET", after: "OTHER_SECRET" },
      }),
    );
    const result = buildQuestions(changes, false);
    expect(result).toHaveLength(9);
    for (const [index, question] of result.entries()) {
      expect(question.groupIndexes).toEqual([index]);
      expect(question.question).toMatch(/[가-힣]/);
      expect(question.question.length).toBeLessThanOrEqual(300);
      if (!changes[index]?.kind.startsWith("formula_"))
        expect(question.question).not.toContain("SECRET");
    }
  });
  it("bounds untrusted sheet names and emits text rather than HTML markup", () => {
    const name = "가".repeat(100);
    const result = buildQuestions(
      [
        {
          ...groups(1)[0],
          kind: "values_changed",
          sheet: name,
          range: "A1",
          summary: { count: 1 },
        },
      ],
      false,
    );
    expect(result[0]?.question).not.toContain("가".repeat(41));
    expect(result[0]?.question.length).toBeLessThan(150);
  });
  it("provides initial and limit-exceeded questions without inventing changes", () => {
    expect(buildQuestions([], true).map((question) => question.kind)).toEqual([
      "purpose",
      "origin",
    ]);
    expect(buildQuestions([], true).every((question) => question.groupIndexes.length === 0)).toBe(
      true,
    );
    expect(buildQuestions(null, false)[0]).toMatchObject({
      kind: "other",
      groupIndexes: [],
      question: "이번 버전에서 무엇을, 왜 바꿨나요?",
    });
  });
  it("keeps Unicode formula questions inside the 300-character API limit", () => {
    const result = buildQuestions(
      [
        {
          kind: "formula_changed",
          sheet: "😀".repeat(50),
          range: "XFD1048576",
          summary: { before: "😀".repeat(100), after: "😀".repeat(100) },
        },
      ],
      false,
    );
    expect(result[0]?.question.length).toBeLessThanOrEqual(300);
    expect(result[0]?.question.isWellFormed()).toBe(true);
  });
});
