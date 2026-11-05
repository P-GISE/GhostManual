import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const form = vi.hoisted(() => ({ cursor: 0, file: null as File | null }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: vi.fn((initial: unknown) => [form.cursor++ === 2 ? form.file : initial, vi.fn()]),
}));
beforeEach(() => {
  form.cursor = 0;
  form.file = null;
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SourceForm } from "../../src/components/SourceForm";

it("offers every approved versioned document format while keeping existing text uploads", () => {
  const html = renderToStaticMarkup(createElement(SourceForm));
  const accept = /accept="([^"]+)"/.exec(html)?.[1]?.split(",") ?? [];
  expect(accept).toEqual(
    expect.arrayContaining([
      ".xlsx",
      ".docx",
      ".hwpx",
      ".pptx",
      ".csv",
      ".hwp",
      ".doc",
      ".ppt",
      ".pdf",
      ".txt",
      ".md",
      ".markdown",
    ]),
  );
  expect(html).toContain("5 MB");
});

it.each([
  ["sample.xlsx", "엑셀은 등록한 뒤 원본 화면의 질문에 답하며 설명을 남깁니다."],
  ["sample.docx", "업무 파일은 처리 후 원본 화면의 질문에 답하며 설명을 남깁니다."],
  ["sample.txt", "파일 안의 글이 업무 내용으로 등록됩니다."],
])("shows format-specific guidance for %s", (name, guidance) => {
  form.file = new File(["synthetic"], name);
  const html = renderToStaticMarkup(createElement(SourceForm));
  expect(html).toContain(guidance);
  expect(html).toContain('aria-label="선택한 파일 지우기"');
});
