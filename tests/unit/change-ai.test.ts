import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { changePrompt } from "../../src/lib/change-ai.ts";
import { compareSnapshots, readXlsx, type Snapshot } from "../../src/lib/xlsx/index.ts";

const snapshot = (name: string): Snapshot => {
  const result = readXlsx(new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`)));
  if (result.status !== "compared") throw new Error("fixture over limit");
  return result.snapshot;
};

it("sends structure, headers and formulas but no cell values", () => {
  const before = snapshot("정산_1029.xlsx");
  const after = snapshot("정산_1030.xlsx");
  const input = changePrompt("월간 정산", after, compareSnapshots(before, after));
  const sent = JSON.stringify(input);
  const header = after.sheets[0]?.cells["A1"]?.v;
  const value = after.sheets[0]?.cells["A2"]?.v;
  expect(typeof header).toBe("string");
  expect(sent).toContain(String(header));
  expect(sent).not.toContain(JSON.stringify(value));
  expect(sent).toContain("SUM(");
  expect(sent).not.toContain("정산_1030.xlsx");
  expect(input.changes.map((c) => c.position)).toEqual([0, 1, 2]);
});
it("caps headers at 30 columns of 40 characters and formulas at 200 characters", () => {
  const cells: Snapshot["sheets"][number]["cells"] = {};
  for (let i = 0; i < 35; i++)
    cells[`${String.fromCharCode(65 + (i % 26)).repeat(i < 26 ? 1 : 2)}1`] = {
      t: "s",
      v: "가".repeat(50),
    };
  const after: Snapshot = {
    v: 1,
    sheets: [{ name: "S", hidden: false, rows: 1, cols: 35, cells }],
    names: [],
  };
  const input = changePrompt("t", after, [
    {
      kind: "formula_changed",
      sheet: "S",
      range: "A2",
      summary: { before: "x".repeat(300), after: "y" },
    },
  ]);
  expect(input.sheets[0]?.headers).toHaveLength(30);
  expect(input.sheets[0]?.headers.every((h) => h.length === 40)).toBe(true);
  expect(input.changes[0]?.before).toHaveLength(200);
});
