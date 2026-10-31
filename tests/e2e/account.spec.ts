import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

test("profile and settings tabs save the department and delete the account", async ({ page }) => {
  const email = await signUpAndVerify(page, undefined, "박효민");
  await page.getByRole("link", { name: "박효민" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("tab", { name: "내 프로필" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByLabel("소속(부서)").fill("재무팀");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("저장했습니다");
  await page.reload();
  await expect(page.getByLabel("소속(부서)")).toHaveValue("재무팀");
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("tab", { name: "설정" }).press("Enter");
  await expect(page.getByRole("tab", { name: "설정" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("progressbar", { name: "저장 공간 사용량" })).toBeVisible();
  await expect(page.getByRole("button", { name: "변경 메일 받기" })).toBeVisible();
  await page.getByLabel("삭제할 내용을 확인했습니다.").check();
  await page.getByRole("button", { name: "계정과 문서 영구 삭제" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/manuals");
  await expect(page.getByRole("link", { name: "로그인 화면으로" })).toBeVisible();
});
