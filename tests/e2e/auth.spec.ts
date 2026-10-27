import { expect, test } from "@playwright/test";
import { logIn, signUp, signUpAndVerify, verificationLink } from "./helpers";

test("sign up, verify by mail, log out and log back in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "시작하기" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  const email = await signUpAndVerify(page, undefined, "박효민");
  await expect(page.getByText("박효민")).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/manuals");
  await expect(page.getByRole("link", { name: "로그인 화면으로" })).toBeVisible();
  await page.getByRole("link", { name: "로그인 화면으로" }).click();
  await logIn(page, email);
  await expect(page).toHaveURL(/\/manuals$/);
  await expect(page.getByText("아직 매뉴얼이 없습니다.")).toBeVisible();
});

test("wrong password and unverified accounts get plain guidance", async ({ page }) => {
  const email = await signUp(page);
  await page.goto("/login");
  await expect(page.getByLabel("이메일")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("비밀번호")).toHaveAttribute("type", "password");
  await expect(page.getByLabel("비밀번호")).toHaveAttribute("autocomplete", "current-password");
  await logIn(page, email);
  await expect(page.locator("[role=alert].error")).toContainText("이메일 인증을 먼저 완료하세요.");
  await page.getByRole("button", { name: "인증 메일 다시 보내기" }).click();
  await expect(page.getByText("인증 메일을 다시 보냈습니다.")).toBeVisible();
  await page.goto(await verificationLink(email));
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill("wrong password 1");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.locator("[role=alert].error")).toContainText("이메일 또는 비밀번호가 올바르지 않습니다.");
});

test("used verification link sends the visitor to login with guidance", async ({ page }) => {
  const email = await signUp(page);
  const link = await verificationLink(email);
  await page.goto(link);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?error=invalid_link$/);
  await expect(page.getByText("인증 링크가 만료됐거나 이미 사용됐습니다.")).toBeVisible();
});
