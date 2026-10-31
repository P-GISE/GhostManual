import { describe, expect, it } from "vitest";
import { compareSnapshots } from "../../src/lib/xlsx/compare.ts";
import { normalizeFormula, shiftFormula } from "../../src/lib/xlsx/formula.ts";
import type { Cell, SheetSnapshot, Snapshot } from "../../src/lib/xlsx/types.ts";

const sheet = (cells: Record<string, Cell>, name = "원본"): SheetSnapshot => ({
  name,
  hidden: false,
  rows: 4,
  cols: 6,
  cells,
});
const book = (...sheets: SheetSnapshot[]): Snapshot => ({ v: 1, sheets, names: [] });
const number = (v: number): Cell => ({ t: "n", v });
const formula = (f: string, v = 0): Cell => ({ t: "n", v, f });

describe("xlsx formula references", () => {
  it("processes long non-reference identifiers within a bounded time", async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const identifier = "a".repeat(100_000);
    expect(shiftFormula(`${identifier}+A1`, "A1", "B2")).toBe(`${identifier}+B2`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }, 2_000);
  it("shifts relative references while preserving literals, names, functions and absolute axes", () => {
    expect(
      shiftFormula(
        "SUM(A1,$B2,C$3,$D$4,\"A1\",'A1 보고서'!E5,LOG10(A1),A1_name,Table1[A1])",
        "F2",
        "G4",
      ),
    ).toBe("SUM(B3,$B4,D$3,$D$4,\"A1\",'A1 보고서'!F7,LOG10(B3),A1_name,Table1[A1])");
  });
  it("handles escaped quotes and out-of-sheet relative references", () => {
    expect(shiftFormula('IF(A1="say ""A1""",\'Joe\'\'s A1\'!B2,0)', "B2", "A1")).toBe(
      'IF(#REF!="say ""A1""",\'Joe\'\'s A1\'!A1,0)',
    );
  });
  it("normalizes same relative formula and keeps different absolute axes distinct", () => {
    expect(normalizeFormula("SUM(B2:E2)+$A$1", "F2")).toBe(
      normalizeFormula("SUM(B3:E3)+$A$1", "F3"),
    );
    expect(normalizeFormula("$B2", "F2")).not.toBe(normalizeFormula("B2", "F2"));
  });
  it("shifts whole-column and whole-row ranges including absolute axes", () => {
    expect(shiftFormula("SUM(A:C,$B:$D,1:3,$2:$4)", "F2", "G4")).toBe("SUM(B:D,$B:$D,3:5,$2:$4)");
    expect(normalizeFormula("SUM(A:C,1:3)", "F2")).toBe(normalizeFormula("SUM(B:D,3:5)", "G4"));
  });
  it("preserves cell-like names in 3D sheet qualifiers", () => {
    expect(shiftFormula("SUM(A1:B2!C3)", "D4", "E5")).toBe("SUM(A1:B2!D4)");
  });
});

describe("compareSnapshots", () => {
  it("returns no change for same values regardless of map insertion order or formula cache", () => {
    const before = book(sheet({ B1: formula("A1*2", 4), A1: number(2) }));
    const after = book(sheet({ A1: number(2), B1: formula("A1*2", 8) }));
    expect(compareSnapshots(before, after)).toEqual([]);
  });
  it("compares scalar types and reports a bounded count without copying cell values", () => {
    const changes = compareSnapshots(
      book(sheet({ A1: number(1) })),
      book(sheet({ A1: { t: "s", v: "private-secret" }, C3: number(2) })),
    );
    expect(changes).toEqual([
      { kind: "values_changed", sheet: "원본", range: "A1:C3", summary: { count: 2 } },
    ]);
    expect(JSON.stringify(changes)).not.toContain("private-secret");
  });
  it("groups equivalent row-relative formula changes in the same column", () => {
    const changes = compareSnapshots(
      book(sheet({ F2: formula("SUM(B2:E2)"), F3: formula("SUM(B3:E3)") })),
      book(sheet({ F3: formula("AVERAGE(B3:E3)"), F2: formula("AVERAGE(B2:E2)") })),
    );
    expect(changes).toEqual([
      {
        kind: "formula_changed",
        sheet: "원본",
        range: "F2:F3",
        summary: { count: 2, before: "SUM(B2:E2)", after: "AVERAGE(B2:E2)" },
      },
    ]);
  });
  it("does not merge distinct old formulas that become one new relative formula", () => {
    const changes = compareSnapshots(
      book(sheet({ F2: formula("A2"), F3: formula("B3") })),
      book(sheet({ F2: formula("C2"), F3: formula("C3") })),
    );
    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.range)).toEqual(["F2", "F3"]);
  });
  it("distinguishes added and removed formulas without duplicate value changes", () => {
    const changes = compareSnapshots(
      book(sheet({ B1: number(1), C1: formula("A1") })),
      book(sheet({ B1: formula("A1"), C1: number(1) })),
    );
    expect(changes.map((change) => change.kind)).toEqual(["formula_added", "formula_removed"]);
  });
  it("reports sheet rename as removal and addition, deterministically", () => {
    const changes = compareSnapshots(book(sheet({}, "옛이름")), book(sheet({}, "새이름")));
    expect(changes.map((change) => [change.kind, change.sheet])).toEqual([
      ["sheet_added", "새이름"],
      ["sheet_removed", "옛이름"],
    ]);
  });
  it("orders sheet, formula, filter, names, dimensions and values by the specified priority", () => {
    const before = {
      ...book({ ...sheet({ A1: number(1) }), autoFilter: { ref: "A1:A4", columns: [] } }),
      names: [{ name: "합계", ref: "원본!A1" }],
    };
    const after = {
      ...book({ ...sheet({ A1: number(2), B1: formula("A1") }), rows: 5 }, sheet({}, "추가")),
      names: [],
    };
    expect(compareSnapshots(before, after).map((change) => change.kind)).toEqual([
      "sheet_added",
      "formula_added",
      "filter_changed",
      "names_changed",
      "size_changed",
      "values_changed",
    ]);
  });
  it("does not treat defined-name or filter column order as a content change", () => {
    const before = {
      ...book({
        ...sheet({}),
        autoFilter: {
          ref: "A1:B4",
          columns: [
            { col: 0, filter: "A" },
            { col: 1, filter: "B" },
          ],
        },
      }),
      names: [
        { name: "B", ref: "원본!B1" },
        { name: "A", ref: "원본!A1" },
      ],
    };
    const after = {
      ...book({
        ...sheet({}),
        autoFilter: {
          ref: "A1:B4",
          columns: [
            { col: 1, filter: "B" },
            { col: 0, filter: "A" },
          ],
        },
      }),
      names: [...before.names].reverse(),
    };
    expect(compareSnapshots(before, after)).toEqual([]);
  });
  it("marks possible row reordering only when full row multisets match", () => {
    const before = book(sheet({ A1: number(1), B1: number(10), A2: number(2), B2: number(20) }));
    const reordered = book(sheet({ A1: number(2), B1: number(20), A2: number(1), B2: number(10) }));
    expect(compareSnapshots(before, reordered)[0]?.summary).toEqual({
      count: 4,
      note: "rows_may_be_reordered",
    });
    const changed = book(sheet({ A1: number(2), B1: number(10), A2: number(1), B2: number(20) }));
    expect(compareSnapshots(before, changed)[0]?.summary).toEqual({ count: 2 });
  });
  it("ignores absent versus empty cells and does not mutate frozen inputs", () => {
    const before = book(sheet({}));
    const after = book(sheet({ A1: { t: "z", v: null } }));
    Object.freeze(before.sheets);
    Object.freeze(after.sheets);
    expect(compareSnapshots(before, after)).toEqual([]);
  });
});
