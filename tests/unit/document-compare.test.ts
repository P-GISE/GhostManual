import { describe, expect, it } from "vitest";
import { compareDocuments, reviewOcrDocuments } from "../../src/lib/documents/compare";
import type { DocumentSnapshot } from "../../src/lib/documents/types";

const snap = (texts: string[]): DocumentSnapshot => ({
  v: 1,
  format: "docx",
  parserVersion: "native-1",
  normalizationVersion: 1,
  extractionMode: "native",
  coverage: [],
  warnings: [],
  blocks: texts.map((text, i) => ({ kind: "paragraph", path: `body/${i + 1}`, text })),
});
describe("bounded sequence document comparison", () => {
  it("front insertion with duplicates yields exactly one addition", () => {
    const r = compareDocuments(
      snap(["same", "same", "tail"]),
      snap(["new", "same", "same", "tail"]),
    );
    expect(r).toEqual({
      status: "compared",
      changes: [{ kind: "block_added", path: "body/1", before: null, after: "new" }],
    });
  });
  it("identifies removal, local modification and unchanged text", () => {
    expect(compareDocuments(snap(["a", "b", "c"]), snap(["a", "B", "c"])).changes).toEqual([
      { kind: "block_modified", path: "body/2", before: "b", after: "B" },
    ]);
    expect(compareDocuments(snap(["a", "b", "c"]), snap(["a", "c"])).changes[0]?.kind).toBe(
      "block_removed",
    );
    expect(compareDocuments(snap(["a"]), snap(["a"])).status).toBe("no_changes");
  });
  it("preserves whitespace and numbers, normalizes only CRLF and Unicode NFC", () => {
    expect(compareDocuments(snap(["a ", "001"]), snap(["a", "1"])).changes).toHaveLength(2);
    expect(compareDocuments(snap(["e\u0301\r\nx"]), snap(["é\nx"])).status).toBe("no_changes");
  });
  it("bounds alignment work and rejects incompatible/partial snapshots", () => {
    expect(
      compareDocuments(
        snap(Array.from({ length: 1500 }, (_, i) => `a${i}`)),
        snap(Array.from({ length: 1500 }, (_, i) => `b${i}`)),
      ).status,
    ).toBe("limit_exceeded");
    const a = snap(["a"]);
    expect(compareDocuments(a, { ...a, parserVersion: "other" }).status).toBe("limit_exceeded");
    expect(compareDocuments(a, { ...a, warnings: ["partial"] }).status).toBe("limit_exceeded");
  });
  it("distinguishes cell boundaries when rendered row strings collide", () => {
    const a = snap(["a\tb\tc"]);
    a.blocks = [{ kind: "table-row", path: "row/1", text: "a\tb\tc", cells: ["a\tb", "c"] }];
    const b: DocumentSnapshot = {
      ...a,
      blocks: [{ kind: "table-row", path: "row/1", text: "a\tb\tc", cells: ["a", "b\tc"] }],
    };
    expect(compareDocuments(a, b).status).toBe("compared");
  });
});

const ocr = (texts: string[]): DocumentSnapshot => ({
  ...snap(texts),
  format: "pdf",
  parserVersion: "tika-4.2.0-gm1",
  extractionMode: "ocr",
  warnings: ["OCR 결과 원본 대조 필요"],
  blocks: texts.map((text, i) => ({ kind: "page", path: `page/${i + 1}`, text })),
});
describe("owner-only provisional OCR review", () => {
  it("returns two raw OCR text changes without weakening normal comparison or mutating snapshots", () => {
    const previous = ocr(["OLD_ONE", "OLD_TWO"]),
      current = ocr(["NEW_ONE", "NEW_TWO"]);
    const before = JSON.stringify([previous, current]);
    for (const s of [previous, current]) {
      for (const b of s.blocks) Object.freeze(b);
      Object.freeze(s.blocks);
      Object.freeze(s.warnings);
      Object.freeze(s);
    }
    expect(reviewOcrDocuments(previous, current)).toEqual({
      status: "review_required",
      changes: [
        { kind: "block_modified", path: "page/1", before: "OLD_ONE", after: "NEW_ONE" },
        { kind: "block_modified", path: "page/2", before: "OLD_TWO", after: "NEW_TWO" },
      ],
    });
    expect(compareDocuments(previous, current)).toEqual({ status: "limit_exceeded", changes: [] });
    expect(JSON.stringify([previous, current])).toBe(before);
  });
  it("requires review for identical OCR text with the accuracy warning", () => {
    const a = ocr(["same"]);
    expect(reviewOcrDocuments(a, a)).toEqual({ status: "review_required", changes: [] });
  });
  it("rejects native, unknown warnings, empty blocks and incompatible versions", () => {
    const a = ocr(["a"]);
    const invalid: DocumentSnapshot[] = [
      snap(["a"]),
      { ...a, extractionMode: "native" },
      { ...a, format: "docx" },
      { ...a, warnings: [...a.warnings, "partial"] },
      { ...a, blocks: [] },
      { ...a, parserVersion: "other" },
      { ...a, parserVersion: "" },
      Object.assign(ocr(["a"]), { v: 2 }),
      Object.assign(ocr(["a"]), { normalizationVersion: 2 }),
    ];
    for (const b of invalid) {
      expect(reviewOcrDocuments(a, b)).toBeNull();
      expect(reviewOcrDocuments(b, a)).toBeNull();
    }
    const wrongVersion = Object.assign(ocr(["a"]), { v: 2 });
    expect(reviewOcrDocuments(wrongVersion, wrongVersion)).toBeNull();
  });
  it("rejects invalid block shapes and content budgets before diffing", () => {
    const a = ocr(["a"]);
    const invalid: DocumentSnapshot[] = [
      ocr(["x".repeat(200001)]),
      ocr(Array(5001).fill("x")),
      {
        ...a,
        blocks: [{ kind: "table-row", path: "page/1", text: "", cells: Array(50001).fill("") }],
      },
      {
        ...a,
        blocks: [{ kind: "table-row", path: "page/1", text: "", cells: ["x".repeat(200001)] }],
      },
      {
        ...a,
        blocks: [Object.assign({ kind: "page" as const, path: "page/1", text: "" }, { text: 17 })],
      },
    ];
    for (const b of invalid) expect(reviewOcrDocuments(a, b)).toBeNull();
  });
  it("returns null when bounded alignment cannot compare the OCR blocks", () => {
    const a = ocr(Array.from({ length: 1500 }, (_, i) => `old${i}`)),
      b = ocr(Array.from({ length: 1500 }, (_, i) => `new${i}`));
    expect(reviewOcrDocuments(a, b)).toBeNull();
  });
});

it.each([{ warnings: [] }, { warnings: ["OCR 결과 원본 대조 필요", "OCR 결과 원본 대조 필요"] }])(
  "rejects absent or duplicate OCR accuracy warnings %#",
  ({ warnings }) => {
    const a = ocr(["a"]),
      invalid = { ...a, warnings };
    expect(reviewOcrDocuments(invalid, a)).toBeNull();
    expect(reviewOcrDocuments(a, invalid)).toBeNull();
    expect(reviewOcrDocuments(invalid, invalid)).toBeNull();
  },
);
