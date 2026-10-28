import { expect, test } from "@playwright/test";
import { loadExample, logIn, openAsNewReader, signUpAndVerify, turnOnLinkSharing } from "./helpers";

test("owner can revoke an existing share after reloading the manual", async ({ page, browser }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  const url = await turnOnLinkSharing(page);
  const { context: reader, page: readerPage } = await openAsNewReader(
    browser,
    url,
    page.viewportSize(),
  );
  await expect(
    readerPage.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("비공개", { exact: true }).check();
  await readerPage.reload();
  await expect(readerPage.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("비공개", { exact: true })).toBeChecked();
  await expect(page.getByLabel("읽기 전용 링크")).toHaveCount(0);
  await reader.close();
});

test("owner sees edited draft separately from the published immutable version", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "초안 수정", exact: true }).click();
  const purpose = page.getByLabel("업무 목적", { exact: true });
  const publishedPurpose = await purpose.inputValue();
  await purpose.fill("검수하지 않은 새로운 업무 목적입니다.");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  await expect(page.getByText("초안 · 검수 전", { exact: true })).toBeVisible();
  await expect(
    page.getByText("검수하지 않은 새로운 업무 목적입니다.", { exact: true }),
  ).toBeVisible();
  const published = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "게시된 검수 버전 1 보기" }) });
  await published.locator("summary").click();
  await expect(published.getByText(publishedPurpose, { exact: true })).toBeVisible();
  await expect(
    published.getByText("검수하지 않은 새로운 업무 목적입니다.", { exact: true }),
  ).toHaveCount(0);
});

test("a signed-out visitor logs in and returns to the shared manual", async ({ page, browser }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(page.getByLabel("비공개", { exact: true })).toBeChecked();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  const url = await turnOnLinkSharing(page);
  const accountContext = await browser.newContext({ viewport: page.viewportSize() });
  const email = await signUpAndVerify(await accountContext.newPage(), undefined, "후임자");
  await accountContext.close();
  const visitor = await browser.newContext({ viewport: page.viewportSize() });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(url);
  await expect(visitorPage).toHaveURL(/\/login\?next=/);
  await logIn(visitorPage, email);
  await expect(
    visitorPage.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
  ).toBeVisible();
  await expect(visitorPage).toHaveURL(/\/share$/);
  await visitor.close();
});
