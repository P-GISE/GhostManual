import { expect, test } from "@playwright/test";
import { loadExample, signUpAndVerify } from "./helpers";

test("a published manual prints only its finished content", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(page.getByRole("button", { name: "인쇄 / PDF 저장" })).toHaveCount(0);
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true }).first()).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed++;
    };
  });
  await page.getByRole("button", { name: "인쇄 / PDF 저장" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  await page.emulateMedia({ media: "print" });
  const sheet = page.locator(".print-sheet");
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
  ).toBeVisible();
  await expect(sheet.getByText(/검수 완료 · 버전 1 · 게시 \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeHidden();
  await expect(page.getByLabel("업무 질문", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "검수 완료·버전 게시" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(sheet).toBeHidden();
});
