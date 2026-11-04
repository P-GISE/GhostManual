import { expect, test } from "@playwright/test";
import { logIn, password, resetLink, signUp, signUpAndVerify, verificationLink } from "./helpers";

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
  await expect(page.getByText("아직 등록한 업무가 없습니다.")).toBeVisible();
});

test("wrong password and unverified accounts get plain guidance", async ({ page }) => {
  const email = await signUp(page);
  await page.goto("/login");
  await expect(page.getByLabel("이메일")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  await logIn(page, email);
  await expect(page.locator("[role=alert].error")).toContainText("이메일 인증을 먼저 완료하세요.");
  await page.getByRole("button", { name: "인증 메일 다시 보내기" }).click();
  await expect(page.getByText("인증 메일을 다시 보냈습니다.")).toBeVisible();
  await page.goto(await verificationLink(email));
  await page.getByRole("button", { name: "로그아웃" }).click();
  // Verification already lands on "/", so wait for the signed-out header instead of the URL.
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill("wrong password 1");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.locator("[role=alert].error")).toContainText(
    "이메일 또는 비밀번호가 올바르지 않습니다.",
  );
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

test("signup checks the repeated password and both pages can reveal it", async ({ page }) => {
  let signups = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/signup") signups++;
  });
  await page.goto("/signup");
  await page.getByLabel("이름").fill("확인");
  await page.getByLabel("이메일").fill("mismatch@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse 9");
  await page.getByLabel("비밀번호 확인", { exact: true }).fill("correct horse 8");
  await page.getByLabel("이용약관과 개인정보 안내에 동의합니다.").check();
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page.locator("[role=alert].error")).toContainText("비밀번호가 서로 다릅니다.");
  expect(signups).toBe(0);
  const field = page.getByLabel("비밀번호", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
  await expect(field).toHaveAttribute("type", "text");
  await expect(field).toHaveValue("correct horse 9");
  await expect(page.getByRole("button", { name: "비밀번호 숨기기", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("비밀번호 확인", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.goto("/login");
  await page.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute("type", "text");
});

test("a forgotten password is reset by mail and the new one works", async ({ page }) => {
  const email = await signUpAndVerify(page);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await page.getByRole("link", { name: "비밀번호를 잊으셨나요?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("이메일").fill(email);
  await page.getByRole("button", { name: "재설정 메일 받기" }).click();
  await expect(page.getByText("재설정 메일을 보냈습니다.", { exact: false })).toBeVisible();
  await page.goto(await resetLink(email));
  await expect(page).toHaveURL(/\/reset-password$/);
  const fresh = "brand new pass 7";
  await page.getByLabel("새 비밀번호", { exact: true }).fill(fresh);
  await page.getByLabel("새 비밀번호 확인", { exact: true }).fill(fresh);
  await page.getByRole("button", { name: "비밀번호 바꾸기" }).click();
  await expect(page).toHaveURL(/\/login\?notice=password_reset$/);
  await expect(page.getByText("비밀번호를 바꿨습니다.", { exact: false })).toBeVisible();
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.locator("[role=alert].error")).toContainText("올바르지 않습니다");
  await page.getByLabel("비밀번호", { exact: true }).fill(fresh);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("signup cannot be sent without agreeing to the terms", async ({ page }) => {
  let signups = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/signup") signups++;
  });
  await page.goto("/signup");
  await page.getByLabel("이름").fill("미동의");
  await page.getByLabel("이메일").fill("no-consent@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page.getByLabel("이용약관과 개인정보 안내에 동의합니다.")).toBeFocused();
  expect(signups).toBe(0);
  await expect(page.getByRole("link", { name: "이용약관" }).first()).toHaveAttribute(
    "href",
    "/terms",
  );
});

test("leaving terms logs out without deleting the account", async ({ page }) => {
  let deletes = 0;
  let logouts = 0;
  await page.route("**/api/me", async (route) => {
    if (route.request().method() === "DELETE") deletes++;
    await route.fulfill({
      json: { name: "기존 사용자", email: "existing@example.com", newAccount: true },
    });
  });
  await page.route("**/api/auth/logout", async (route) => {
    logouts++;
    await route.fulfill({ json: { loggedOut: true } });
  });
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { name: "이용약관을 확인해 주세요" })).toBeVisible();
  await page.getByRole("button", { name: "동의하지 않고 나가기" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(logouts).toBe(1);
  expect(deletes).toBe(0);
});

test("a shared link survives the pending terms redirect", async ({ page }) => {
  await page.route("**/api/share", (route) =>
    route.fulfill({ status: 403, json: { error: { code: "terms_required" } } }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { name: "기존 사용자", email: "existing@example.com" } }),
  );
  await page.goto("/share#pending-terms-link");
  await expect(page).toHaveURL(/\/welcome\?next=%2Fshare%23pending-terms-link$/);
});
