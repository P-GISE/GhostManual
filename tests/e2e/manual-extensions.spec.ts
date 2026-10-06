import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "CF-Connecting-IP": "198.51.100.30" });
});

test("title and review filters combine without hiding original sources", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "합성 예제 열기" }).click();
  await page.getByLabel("매뉴얼 제목 검색").fill("없는문서");
  await expect(page.getByText("검색·상태 조건에 맞는 매뉴얼이 없습니다.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /원본 자료/ })).toBeVisible();
  await page.getByLabel("매뉴얼 제목 검색").fill("계정");
  await page.getByLabel("검수 상태", { exact: true }).selectOption("published");
  await expect(page.getByText("검색·상태 조건에 맞는 매뉴얼이 없습니다.")).toBeVisible();
  await page.getByLabel("검수 상태", { exact: true }).selectOption("draft");
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "문서함", exact: true }).click();
  await page.getByLabel("검수 상태", { exact: true }).selectOption("published");
  await expect(page.getByRole("heading", { name: "신입 구성원 업무 계정 발급" })).toBeVisible();
});
test("publication comparison shows changed fields while a later draft remains private", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "합성 예제 열기" }).click();
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  async function publish(version: number) {
    await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
    await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
    await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
    await expect(page.getByText(`검수 완료 · 버전 ${version}`, { exact: true })).toBeVisible();
  }
  await publish(1);
  await page.getByRole("link", { name: "초안 수정", exact: true }).click();
  await page.getByLabel("업무 목적", { exact: true }).fill("게시된 새 목적입니다.");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.")).toBeVisible();
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  await publish(2);
  await page.getByRole("link", { name: "초안 수정", exact: true }).click();
  await page.getByLabel("업무 목적", { exact: true }).fill("아직 게시하지 않은 목적");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.")).toBeVisible();
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  const compare = page
    .locator("details")
    .filter({ has: page.getByText("게시 버전 변경점 비교", { exact: true }) });
  await compare.locator("summary").click();
  await expect(compare.getByText("아직 게시하지 않은 목적", { exact: true })).toHaveCount(0);
  await expect(compare.getByText("게시된 새 목적입니다.", { exact: true })).toBeVisible();
  await expect(compare.getByRole("heading", { name: "업무 목적", exact: true })).toBeVisible();
  await page.getByLabel("이후 게시 버전").selectOption("1");
  await expect(compare.getByText("이전 버전보다 큰 이후 버전을 선택하세요.")).toBeVisible();
  await page.getByLabel("이후 게시 버전").selectOption("2");
  await page.getByRole("button", { name: "공유 링크 만들기" }).click();
  const url = await page.getByLabel("읽기 전용 링크").inputValue();
  const reader = await browser.newContext({ viewport: page.viewportSize() });
  const rp = await reader.newPage();
  await rp.goto(url);
  await expect(rp.getByRole("heading", { name: "신입 구성원 업무 계정 발급" })).toBeVisible();
  await expect(rp.getByText("게시 버전 변경점 비교")).toHaveCount(0);
  await expect(rp.getByText("아직 게시하지 않은 목적", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reader.close();
});
