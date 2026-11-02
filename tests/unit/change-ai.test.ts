import { readFileSync } from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";
import { changePrompt } from "../../src/lib/change-ai.ts";
import { compareSnapshots, readXlsx, type Snapshot } from "../../src/lib/xlsx/index.ts";

const snapshot = (name: string): Snapshot => {
  const result = readXlsx(new Uint8Array(readFileSync(`tests/fixtures/xlsx/${name}`)));
  if (result.status !== "compared") throw new Error("fixture over limit");
  return result.snapshot;
};

it("sends structure and formulas but no first-row or ordinary cell values", () => {
  const before = snapshot("정산_1029.xlsx");
  const after = snapshot("정산_1030.xlsx");
  const input = changePrompt("월간 정산", after, compareSnapshots(before, after));
  const sent = JSON.stringify(input);
  const header = after.sheets[0]?.cells["A1"]?.v;
  const value = after.sheets[0]?.cells["A2"]?.v;
  expect(typeof header).toBe("string");
  expect(sent).not.toContain(String(header));
  expect(sent).not.toContain(JSON.stringify(value));
  expect(sent).toContain("SUM(");
  expect(sent).not.toContain("정산_1030.xlsx");
  expect(input.changes.map((c) => c.position)).toEqual([0, 1, 2]);
});
it("excludes all first-row values and caps formulas at 200 characters", () => {
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
  expect(input.sheets).toEqual([{ name: "S", rows: 1, cols: 35 }]);
  expect(JSON.stringify(input)).not.toContain("가".repeat(50));
  expect(input.changes[0]?.before).toHaveLength(200);
});
it("excludes every first-row value including text and formula caches", () => {
  const after: Snapshot = {
    v: 1,
    sheets: [
      {
        name: "정산",
        hidden: false,
        rows: 1,
        cols: 4,
        cells: {
          A1: { t: "s", v: "합계" },
          B1: { t: "n", v: 175, f: "SUM(원본!B2:B3)" },
          C1: { t: "b", v: true },
          D1: { t: "s", v: "cached-result", f: "A2" },
        },
      },
    ],
    names: [],
  };
  const input = changePrompt("t", after, []);
  expect(JSON.stringify(input)).not.toMatch(/합계|cached-result/);
  expect(JSON.stringify(input)).not.toContain("175");
});
it("keeps numbers out of the stored search text as well", async () => {
  const { fileText } = await import("../../src/lib/file-sources.ts");
  const text = fileText("월간 정산", {
    status: "compared",
    snapshot: {
      v: 1,
      sheets: [
        {
          name: "정산",
          hidden: false,
          rows: 1,
          cols: 2,
          cells: {
            A1: { t: "s", v: "합계" },
            B1: { t: "n", v: 175 },
            C1: { t: "s", v: "cached-result", f: "A2" },
          },
        },
      ],
      names: [],
    },
  });
  expect(text).not.toContain("합계");
  expect(text).toContain("시트 정산");
  expect(text).not.toContain("175");
  expect(text).not.toContain("cached-result");
});

it("keeps array-formula follower caches out of AI and stored search text", async () => {
  const entries = unzipSync(new Uint8Array(readFileSync("tests/fixtures/xlsx/정산_1029.xlsx")));
  entries["xl/worksheets/sheet1.xml"] = strToU8(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="str"><f t="array" ref="A1:B1">TRANSPOSE(A2:A3)</f><v>anchor-cache</v></c><c r="B1" t="str"><v>private-cache</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>source-private</t></is></c></row></sheetData></worksheet>`,
  );
  const result = readXlsx(zipSync(entries));
  if (result.status !== "compared") throw new Error("expected snapshot");
  expect(result.snapshot.sheets[0]?.cells["B1"]?.v).toBe("private-cache");
  const { fileText } = await import("../../src/lib/file-sources.ts");
  expect(JSON.stringify(changePrompt("synthetic", result.snapshot, []))).not.toMatch(
    /anchor-cache|private-cache|source-private/,
  );
  expect(fileText("synthetic", result)).not.toMatch(/anchor-cache|private-cache|source-private/);
});
