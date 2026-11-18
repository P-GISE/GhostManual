import { expect, type Page, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

const sourceId = "7b2ad36b-9c2b-4310-a48c-f5585680bc11";
const revisionId = "7b2ad36b-9c2b-4310-a48c-f5585680bc12";
const manualId = "7b2ad36b-9c2b-4310-a48c-f5585680bc13";
const templateId = "7b2ad36b-9c2b-4310-a48c-f5585680bc14";
const createdAt = "2026-11-18T00:00:00.000Z";
const source = {
  id: sourceId,
  revisionId,
  revision: 1,
  title: "합성 업무",
  text: "합성 원본입니다. ".repeat(20),
  createdAt,
};
const draft = (version: number) => ({
  title: `합성 제목 ${version}`,
  template: { id: templateId, name: "합성 양식" },
  sections: ["비고", "비고", "제목", "미확인 항목", "원본 인용"].map((name, index) => ({
    id: index < 2 ? `duplicate-${index}` : ["title", "unknowns", "references"][index - 2],
    name,
    guide: "",
    kind: "text",
    text: `항목 ${index + 1} 내용 ${version}`,
    items: [],
    state: "filled",
    by: "human",
  })),
  unknowns: [`확인할 내용 ${version}`],
  references: [{ field: "title", paragraphId: "p1", quote: `인용 ${version}` }],
});
const manual = {
  id: manualId,
  sourceId,
  sourceRevisionId: revisionId,
  draft: draft(1),
  draftRevision: 1,
  publishedVersion: null,
  published: null,
  needsReview: false,
  provenance: "human",
  createdAt,
};
async function mockSource(page: Page) {
  await page.route(`**/api/sources/${sourceId}`, (route) => route.fulfill({ json: source }));
}

test("version comparison preserves duplicate labels and metadata-named sections", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await mockSource(page);
  const versions = [1, 2].map((version) => ({
    id: crypto.randomUUID(),
    manualId,
    version,
    sourceRevisionId: revisionId,
    content: draft(version),
    provenance: "human",
    acknowledgedUnknowns: [],
    createdAt,
  }));
  await page.route(`**/api/manuals/${manualId}`, (route) =>
    route.fulfill({
      json: { ...manual, draft: draft(2), publishedVersion: 2, published: versions[1] },
    }),
  );
  await page.route(`**/api/manuals/${manualId}/versions`, (route) =>
    route.fulfill({ json: versions }),
  );
  await page.route("**/api/shares?*", (route) => route.fulfill({ json: { mode: "private" } }));
  await page.goto(`/manuals/${manualId}`);
  const compare = page
    .locator("details")
    .filter({ has: page.getByText("게시 버전 변경점 비교", { exact: true }) });
  await compare.locator("summary").click();
  await expect(
    compare.getByText("버전 1 → 버전 2 · 내용 변경 8개 · 검수·근거 기록 변경 0개"),
  ).toBeVisible();
  await expect(compare.getByRole("heading", { name: "비고", exact: true })).toHaveCount(2);
  for (const version of [1, 2]) {
    for (const index of [1, 2, 3, 4, 5])
      await expect(
        compare.getByText(`항목 ${index} 내용 ${version}`, { exact: true }),
      ).toBeVisible();
    await expect(compare.getByText(`합성 제목 ${version}`, { exact: true })).toBeVisible();
    await expect(compare.getByText(`확인할 내용 ${version}`, { exact: true })).toBeVisible();
    await expect(
      compare.getByText(`title · 문단 p1: 인용 ${version}`, { exact: true }),
    ).toBeVisible();
  }
  // Stable IDs survive a rename/reorder; new and removed same-name items remain separate.
  const latest = versions[1];
  if (!latest) throw new Error("Second synthetic publication is missing");
  latest.content.sections.reverse();
  const renamed = latest.content.sections.find((section) => section.id === "duplicate-0");
  const replaced = latest.content.sections.find((section) => section.id === "duplicate-1");
  if (!renamed || !replaced) throw new Error("Synthetic duplicate sections are missing");
  renamed.name = "인계 비고";
  replaced.id = "replacement";
  await page.reload();
  await compare.locator("summary").click();
  await expect(
    compare.getByRole("heading", { name: "비고 → 인계 비고", exact: true }),
  ).toBeVisible();
  await expect(
    compare.getByText("버전 1 → 버전 2 · 내용 변경 9개 · 검수·근거 기록 변경 0개"),
  ).toBeVisible();
});

test("template list errors and loading block new drafts until retry, preserving explicit choice", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await mockSource(page);
  let ready = false;
  let release: (() => void) | undefined;
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/templates?ready=1", async (route) => {
    if (!ready)
      return route.fulfill({ status: 503, json: { error: { message: "양식 조회 일시 실패" } } });
    await resumed;
    return route.fulfill({
      json: [
        {
          id: templateId,
          name: "합성 기본 양식",
          isDefault: true,
          items: [{ id: "purpose", name: "목적", guide: "", kind: "text" }],
        },
      ],
    });
  });
  let manualPosts = 0;
  await page.route("**/api/manuals", (route) => {
    if (route.request().method() === "POST") manualPosts++;
    return route.fulfill({ json: [] });
  });
  const generated: unknown[] = [];
  await page.route(`**/api/sources/${sourceId}/generate`, (route) => {
    generated.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: { message: "합성 AI 응답" } } });
  });
  await page.goto(`/sources/${sourceId}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "양식 목록을 불러오지 못했습니다." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 초안 요청" })).toBeDisabled();
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "새 매뉴얼을 만들려면" })).toBeVisible();
  expect(manualPosts).toBe(0);
  ready = true;
  await page.getByRole("button", { name: "양식 목록 다시 불러오기" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "양식 목록을 불러오고 있습니다." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 초안 요청" })).toBeDisabled();
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "새 매뉴얼을 만들려면" })).toBeVisible();
  expect(manualPosts).toBe(0);
  expect(generated).toEqual([]);
  release?.();
  await expect(page.getByLabel("매뉴얼 항목")).toHaveValue(templateId);
  await page.getByRole("button", { name: "AI 초안 요청" }).click();
  await expect.poll(() => generated).toEqual([{ expectedRevision: 1, templateId }]);
  await expect(page.getByRole("button", { name: "AI 초안 요청" })).toBeEnabled();
  await page.getByLabel("매뉴얼 항목").selectOption("");
  await page.getByRole("button", { name: "AI 초안 요청" }).click();
  await expect
    .poll(() => generated)
    .toEqual([
      { expectedRevision: 1, templateId },
      { expectedRevision: 1, templateId: null },
    ]);
});

test("an existing manual stays editable when template listing fails", async ({ page }) => {
  await signUpAndVerify(page);
  await mockSource(page);
  await page.route("**/api/templates?ready=1", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "합성 조회 실패" } } }),
  );
  await page.route("**/api/manuals", (route) => route.fulfill({ json: [manual] }));
  await page.route(`**/api/manuals/${manualId}`, (route) => route.fulfill({ json: manual }));
  await page.goto(`/sources/${sourceId}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "양식 목록을 불러오지 못했습니다." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page).toHaveURL(`/manuals/${manualId}/edit`);
  await expect(page.getByRole("button", { name: "초안 저장", exact: true })).toBeEnabled();
});
