import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

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
