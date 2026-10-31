import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildQuestions, compareSnapshots, readXlsx } from "../../src/lib/xlsx/index.ts";

it("turns the two demonstration workbooks into change questions without exposing cell values", () => {
  const before = readXlsx(readFileSync("tests/fixtures/xlsx/정산_1029.xlsx"));
  const after = readXlsx(readFileSync("tests/fixtures/xlsx/정산_1030.xlsx"));
  if (before.status !== "compared" || after.status !== "compared") {
    throw new Error("Demonstration workbooks must fit within the parsing limits");
  }
  const changes = compareSnapshots(before.snapshot, after.snapshot);
  expect(changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "sheet_added", sheet: "정산" }),
      expect.objectContaining({
        kind: "formula_changed",
        sheet: "원본",
        range: "F2:F40",
        summary: expect.objectContaining({ count: 39 }),
      }),
      expect.objectContaining({ kind: "values_changed", sheet: "원본", summary: { count: 132 } }),
    ]),
  );
  const questions = buildQuestions(changes, false);
  expect(questions.length).toBeGreaterThan(0);
  expect(questions.length).toBeLessThanOrEqual(10);
  expect(questions.some(({ question }) => question.includes("F2:F40"))).toBe(true);
  expect(JSON.stringify(questions)).not.toContain("합성상사");
  expect(questions.flatMap(({ groupIndexes }) => groupIndexes)).toEqual(
    changes.map((_, index) => index),
  );
});
