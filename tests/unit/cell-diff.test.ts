import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { diffCells } from "../../src/lib/cell-diff.ts";
import { readXlsx, type Snapshot } from "../../src/lib/xlsx/index.ts";

const sheet = (name: string, cells: Snapshot["sheets"][number]["cells"]) => ({
  name,
  hidden: false,
  rows: 10,
  cols: 5,
  cells,
});
const book = (...sheets: Snapshot["sheets"]): Snapshot => ({ v: 1, sheets, names: [] });

it("lists every changed, added and removed cell with before and after, in sheet and reading order", () => {
  const before = book(
    sheet("원본", {
      A2: { t: "s", v: "가나상사" },
      B2: { t: "n", v: 120 },
      C2: { t: "n", v: 5 },
      B10: { t: "n", v: 1 },
      F2: { t: "n", v: 125, f: "SUM(B2:E2)" },
    }),
  );
  const after = book(
    sheet("원본", {
      A2: { t: "s", v: "가나유통" },
      B2: { t: "n", v: -15 },
      C2: { t: "n", v: 5 },
      B9: { t: "n", v: 7 },
      F2: { t: "n", v: 5, f: 'SUMIF(B2:E2,">0")' },
    }),
  );
  expect(diffCells(before, after)).toEqual([
    {
      sheet: "원본",
      address: "A2",
      before: { t: "s", v: "가나상사" },
      after: { t: "s", v: "가나유통" },
    },
    { sheet: "원본", address: "B2", before: { t: "n", v: 120 }, after: { t: "n", v: -15 } },
    {
      sheet: "원본",
      address: "F2",
      before: { t: "n", v: 125, f: "SUM(B2:E2)" },
      after: { t: "n", v: 5, f: 'SUMIF(B2:E2,">0")' },
    },
    { sheet: "원본", address: "B9", before: null, after: { t: "n", v: 7 } },
    { sheet: "원본", address: "B10", before: { t: "n", v: 1 }, after: null },
  ]);
});
it("treats cells of added and removed sheets as added and removed", () => {
  const changes = diffCells(
    book(sheet("옛 시트", { A1: { t: "s", v: "x" } })),
    book(sheet("새 시트", { A1: { t: "s", v: "y" } })),
  );
  expect(changes).toEqual([
    { sheet: "옛 시트", address: "A1", before: { t: "s", v: "x" }, after: null },
    { sheet: "새 시트", address: "A1", before: null, after: { t: "s", v: "y" } },
  ]);
});
it("ignores formula cells whose cached result alone changed", () => {
  expect(
    diffCells(
      book(sheet("S", { A1: { t: "n", v: 1, f: "B1*2" } })),
      book(sheet("S", { A1: { t: "n", v: 4, f: "B1*2" } })),
    ),
  ).toEqual([]);
});
it("finds the 132 value and 39 formula changes of the demo workbooks", () => {
  const read = (name: string) => {
    const result = readXlsx(new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`)));
    if (result.status !== "compared") throw new Error("fixture over limit");
    return result.snapshot;
  };
  const changes = diffCells(read("정산_1029.xlsx"), read("정산_1030.xlsx"));
  const original = changes.filter((c) => c.sheet === "원본");
  expect(
    original.filter((c) => c.before?.f === undefined && c.after?.f === undefined),
  ).toHaveLength(132);
  expect(original.filter((c) => c.after?.f !== undefined)).toHaveLength(39);
  expect(changes.some((c) => c.sheet === "정산" && c.before === null)).toBe(true);
});
