import { type Browser, expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

async function freshPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test("an admin blocks a user's AI and a regular user cannot open the admin page", async ({
  page,
  browser,
}, info) => {
  const target = await signUpAndVerify(page, undefined, "대상 사용자");
  await expect(page.getByRole("link", { name: "관리자", exact: true })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "관리자만 볼 수 있습니다" })).toBeVisible();

  const admin = await freshPage(browser);
  const adminEmail =
    process.env[info.project.name === "mobile" ? "E2E_ADMIN_MOBILE" : "E2E_ADMIN_DESKTOP"];
  await signUpAndVerify(admin, adminEmail, "관리자 A");
  await admin.getByRole("link", { name: "관리자", exact: true }).click();
  await expect(admin.getByRole("heading", { name: "사용자와 사용량", level: 1 })).toBeVisible();
  await admin.getByLabel("사용자 검색").fill(adminEmail ?? "");
  await expect(admin.getByRole("row").filter({ hasText: "서버 설정 관리자" })).toHaveCount(1);
  await admin.getByLabel("사용자 검색").fill(target);
  const row = admin.getByRole("row").filter({ hasText: target });
  await expect(row).toHaveCount(1);

  // The box stays checked until the in-page confirmation is accepted.
  await row.getByLabel("대상 사용자 AI 허용").click();
  await admin.getByRole("button", { name: "AI 차단" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "권한을 바꿨습니다" })).toBeVisible();
  await expect(row.getByText("차단됨")).toBeVisible();
  await row.getByLabel("대상 사용자 용량 한도").selectOption({ label: "200 MB" });
  await expect(row.getByText("0 MB / 200 MB")).toBeVisible();
  await expect(admin.getByText(/관리자 A가 대상 사용자의 AI 사용을 차단/).first()).toBeVisible();
  await expect(
    admin.getByText(/대상 사용자의 용량 한도를 기본\(100 MB\) → 200 MB/).first(),
  ).toBeVisible();
  await admin.context().close();
});
