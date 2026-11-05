import { describe, expect, it } from "vitest";
import { fileRevisionSchema, sourceSchema } from "../../src/lib/client";

const id = "00000000-0000-4000-8000-000000000001";
const extraction = { status: "queued", reason: null, coverage: [], resultId: null };
const base = {
  id,
  revisionId: id,
  revision: 1,
  title: "합성 업무",
  text: "구조 확인 대기",
  createdAt: "2026-11-04T00:00:00Z",
  kind: "file",
  fileType: "docx",
  extraction,
};
describe("document browser response contracts", () => {
  it("preserves format and quarantine state instead of treating a document as text or ready", () => {
    const parsed = sourceSchema.parse(base);
    expect(parsed).toMatchObject({ fileType: "docx", extraction });
  });
  it("accepts a queued document revision and keeps its state for disabled download controls", () => {
    const parsed = fileRevisionSchema.safeParse({
      ...base,
      uploadedByName: "합성 사용자",
      uploadedByDepartment: null,
      file: { name: "업무.docx", sizeBytes: 1024 },
      compareStatus: "pending",
      aiSummary: null,
      changes: [],
      questions: [],
      usage: { bytes: 1024, limitBytes: 104857600 },
      preview: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ fileType: "docx", extraction });
  });
  it("rejects unknown processing states rather than silently showing ready", () => {
    expect(
      sourceSchema.safeParse({ ...base, extraction: { ...extraction, status: "maybe_safe" } })
        .success,
    ).toBe(false);
  });
  it("keeps legacy workbook responses compatible without new extraction fields", () => {
    const { fileType: _type, extraction: _state, ...legacy } = base;
    expect(sourceSchema.safeParse(legacy).success).toBe(true);
  });
});
