import { expect, it } from "vitest";
import { fileStem } from "../../src/lib/file-stem.ts";

it.each([
  ["정산_1029.xlsx", "정산"],
  ["정산_1030.xlsx", "정산"],
  ["정산_20261030.xlsx", "정산"],
  ["정산-2026-10-30.xlsx", "정산"],
  ["정산 v2.xlsx", "정산"],
  ["정산_V3.XLSX", "정산"],
  ["정산 (1).xlsx", "정산"],
  ["정산_최종.xlsx", "정산"],
  ["정산_최종_수정본.xlsx", "정산"],
  ["정산_1030_final.xlsx", "정산"],
  ["Copy of 정산.xlsx", "copy of 정산"],
  ["구매요청_집계.xlsx", "구매요청_집계"],
  ["2026 예산.xlsx", "2026 예산"],
])("%s → %s", (name, stem) => {
  expect(fileStem(name)).toBe(stem);
});
it("never reduces a name to nothing", () => {
  expect(fileStem("1030.xlsx")).toBe("1030");
  expect(fileStem("최종.xlsx")).toBe("최종");
});
