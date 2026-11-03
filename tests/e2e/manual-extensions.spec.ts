import { expect, test } from "@playwright/test";
import { loadExample, openAsNewReader, signUpAndVerify, turnOnLinkSharing } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "CF-Connecting-IP": "198.51.100.30" });
});

test("search and status chips combine on the task cards", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByLabel("업무 검색").fill("없는문서");
  await expect(page.getByText("조건에 맞는 업무가 없습니다.")).toBeVisible();
  await page.getByLabel("업무 검색").fill("계정");
  await page.getByRole("button", { name: /^게시됨/ }).click();
  await expect(page.getByText("조건에 맞는 업무가 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: /^할 일 있음/ }).click();
  await expect(page.getByRole("link", { name: "검수하고 게시" })).toBeVisible();
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "문서함", exact: true }).click();
  await page.getByRole("button", { name: /^게시됨/ }).click();
  await expect(page.getByRole("heading", { name: "신입 구성원 업무 계정 발급" })).toBeVisible();
  await expect(page.getByText("게시됨 v1", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "매뉴얼 보기" })).toBeVisible();
});
test("publication comparison shows changed fields while a later draft remains private", async ({
  page,
  browser,
}) => {
  await signUpAndVerify(page);
  await loadExample(page);
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
  const url = await turnOnLinkSharing(page);
  const { context: reader, page: rp } = await openAsNewReader(browser, url, page.viewportSize());
  await expect(rp.getByRole("heading", { name: "신입 구성원 업무 계정 발급" })).toBeVisible();
  await expect(rp.getByText("게시 버전 변경점 비교")).toHaveCount(0);
  await expect(rp.getByText("아직 게시하지 않은 목적", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reader.close();
});
