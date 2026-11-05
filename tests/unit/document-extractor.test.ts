import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractDocument, validateExtraction } from "../../src/lib/document-extractor";
import { compareDocuments } from "../../src/lib/documents/compare.ts";
import { detectDocumentFormat } from "../../src/lib/documents/read.ts";

afterEach(() => vi.unstubAllEnvs());
const valid = () => ({
  status: "ready",
  reason: null,
  coverage: ["본문 텍스트"],
  snapshot: {
    v: 1,
    format: "pdf",
    parserVersion: "tika-4.2.0-gm1",
    normalizationVersion: 1,
    extractionMode: "native",
    blocks: [{ kind: "page", path: "page/1", text: "합성 문서" }],
    coverage: ["본문 텍스트"],
    warnings: [] as string[],
  },
});
describe("external document boundary", () => {
  it("runs native CSV without gateway configuration", async () => {
    expect((await extractDocument("csv", new TextEncoder().encode("한글,값\n행,2"))).status).toBe(
      "ready",
    );
  });
  it("fails closed when external gateway is absent", async () => {
    vi.stubEnv("DOCUMENT_EXTRACTOR_URL", "");
    expect(await extractDocument("pdf", new TextEncoder().encode("%PDF-1.7"))).toMatchObject({
      status: "failed",
      snapshot: null,
    });
  });
  it("rejects oversize input before transport", async () => {
    expect(await extractDocument("pdf", new Uint8Array(5 * 1024 * 1024 + 1))).toMatchObject({
      status: "rejected",
      snapshot: null,
    });
  });
  it("accepts exact bounded format-matched output", () => {
    expect(validateExtraction(valid(), "pdf")).toEqual(valid());
  });
  it("rejects text hidden in public coverage or structural paths", () => {
    const path = valid();
    path.snapshot.blocks = [{ kind: "page", path: "SECRET_OLD", text: "safe" }];
    const coverage = valid();
    coverage.coverage = ["SECRET_OLD"];
    const warnings = valid();
    warnings.snapshot.warnings = ["SECRET_OLD"];
    for (const value of [path, coverage, warnings])
      expect(() => validateExtraction(value, "pdf")).toThrow();
  });
  it("never treats a safety failure or missing snapshot as publishable limited", () => {
    for (const value of [
      { ...valid(), status: "limited", reason: "unsafe_document" },
      { ...valid(), status: "limited", reason: "ocr_uncertain", snapshot: null },
      { ...valid(), snapshot: { ...valid().snapshot, blocks: [] } },
    ])
      expect(() => validateExtraction(value, "pdf")).toThrow();
  });
  it("rejects wrong format, unknown fields and forged ready-null", () => {
    const a = valid();
    a.snapshot.format = "doc";
    for (const value of [
      a,
      { ...valid(), url: "https://metadata" },
      { ...valid(), snapshot: null },
    ])
      expect(() => validateExtraction(value, "pdf")).toThrow();
  });
  it("rejects excess pages, characters, blocks and raw error reasons", () => {
    const pages = valid();
    pages.snapshot.blocks = Array.from({ length: 21 }, (_, i) => ({
      kind: "page",
      path: `page/${i + 1}`,
      text: "x",
    }));
    const chars = valid();
    chars.snapshot.blocks = [{ kind: "page", path: "page/1", text: "x".repeat(200001) }];
    const blocks = valid();
    blocks.snapshot.blocks = Array.from({ length: 5001 }, () => ({
      kind: "paragraph",
      path: "p",
      text: "x",
    }));
    for (const value of [
      pages,
      chars,
      blocks,
      { status: "failed", snapshot: null, reason: "secret stack", coverage: [] },
    ])
      expect(() => validateExtraction(value, "pdf")).toThrow();
  });
  it("does not allow plaintext, credentials, query, path or fragment gateway URLs", async () => {
    for (const url of [
      "http://localhost:9999",
      "https://user:pass@localhost",
      "https://localhost/path",
      "https://localhost?url=x",
      "https://localhost#x",
    ]) {
      vi.stubEnv("DOCUMENT_EXTRACTOR_URL", url);
      expect(await extractDocument("pdf", new TextEncoder().encode("%PDF-1.7"))).toMatchObject({
        status: "failed",
        snapshot: null,
      });
    }
  });
});

it.each([
  ["sample", "hwp"],
  ["office", "doc"],
  ["slides", "ppt"],
  ["text", "pdf"],
  ["scan-ko", "pdf"],
] as const)("compares actual %s parser fixture outputs", (prefix, format) => {
  const bytes = readFileSync(
    new URL(`../fixtures/documents/external/${prefix}-v1.${format}`, import.meta.url),
  );
  expect(detectDocumentFormat(`fixture.${format}`, bytes)).toBe(format);
  const results = [1, 2].map((version) =>
    validateExtraction(
      JSON.parse(
        readFileSync(
          new URL(`../fixtures/documents/external/${prefix}-v${version}.json`, import.meta.url),
          "utf8",
        ),
      ),
      format,
    ),
  );
  const previous = results[0]?.snapshot;
  const current = results[1]?.snapshot;
  expect(previous).toBeTruthy();
  expect(current).toBeTruthy();
  if (!previous || !current) throw new Error("Fixture extraction missing");
  const comparison = compareDocuments(previous, current);
  if (prefix === "scan-ko") {
    expect(previous.blocks).not.toEqual(current.blocks);
    expect(comparison.status).toBe("limit_exceeded");
    return;
  }
  expect(comparison.status).toBe("compared");
  expect(comparison.changes).toHaveLength(1);
  expect(comparison.changes[0]?.kind).toBe("block_modified");
});
