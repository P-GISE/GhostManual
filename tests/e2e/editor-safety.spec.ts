import { expect, test } from "@playwright/test";
import { loadExample, signUpAndVerify } from "./helpers";

test("owner can clear optional lists and cancel unsaved navigation", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(
    page.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "초안 수정", exact: true }).click();
  await page.getByLabel("준비 자료", { exact: true }).fill("");
  await page.getByLabel("미확인 항목", { exact: true }).fill("\n   \n");
  const editUrl = page.url();
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  await expect(page).toHaveURL(editUrl);
  await expect(page.getByLabel("준비 자료", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("준비 자료", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("미확인 항목", { exact: true })).toHaveValue("");
});

test("source registration preserves input when navigation is cancelled", async ({ page }) => {
  await signUpAndVerify(page);
  await page.getByRole("link", { name: "새 자료 등록" }).click();
  await page.getByLabel("자료 제목").fill("미저장 원본 제목");
  const sourceUrl = page.url();
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "문서함", exact: true }).click();
  await expect(page).toHaveURL(sourceUrl);
  await expect(page.getByLabel("자료 제목")).toHaveValue("미저장 원본 제목");
});
