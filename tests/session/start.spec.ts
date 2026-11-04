import { expect, type Page, test } from "@playwright/test";

const expiresAt = "2099-01-01T00:00:00.000Z";
async function fixture(page: Page, sessionStatus = 200, listStatus = 200) {
  const calls = { logins: 0, sessions: 0 };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/login") {
      calls.logins++;
      await route.fulfill({ status: 200, json: { expiresAt } });
    } else if (path === "/api/session") {
      calls.sessions++;
      await route.fulfill({
        status: sessionStatus,
        json:
          sessionStatus === 200
            ? { role: "owner", expiresAt, manualId: null }
            : { error: { message: "로그인이 필요합니다." } },
      });
    } else if (path === "/api/manuals" || path === "/api/sources") {
      await route.fulfill({
        status: listStatus,
        json: listStatus === 200 ? [] : { error: { message: "조회할 수 없습니다." } },
      });
    } else {
      await route.abort();
    }
  });
  return calls;
}
async function submitLogin(page: Page) {
  await page.getByLabel("이메일").fill("a@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse 9");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

test("login: session round-trip precedes document navigation", async ({ page }) => {
  const calls = await fixture(page);
  await page.goto("/login");
  await submitLogin(page);
  await expect(page).toHaveURL(/\/$/);
  expect(calls.sessions).toBe(1);
  expect(calls.logins).toBe(1);
});

test("login keeps a safe next path and ignores external ones", async ({ page }) => {
  await fixture(page);
  await page.goto("/login?next=%2Fask");
  await submitLogin(page);
  await expect(page).toHaveURL(/\/ask$/);
  await page.goto("/login?next=%2F%2Fevil.example");
  await submitLogin(page);
  await expect(page).toHaveURL(/\/$/);
});

test("login then missing session stays on login; retry checks session without another POST", async ({
  page,
}) => {
  const calls = await fixture(page, 401);
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("[role=alert].error")).toContainText("세션");
  await expect(page.getByText(/Safari 또는 Chrome/)).toBeVisible();
  await page.getByRole("button", { name: "세션 다시 확인" }).click();
  await expect.poll(() => calls.sessions).toBe(2);
  expect(calls.logins).toBe(1);
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { role: "owner", expiresAt, manualId: null },
    }),
  );
  await page.getByRole("button", { name: "세션 다시 확인" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(calls.logins).toBe(1);
});

test("session transport failure stays on login", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/session", (route) => route.abort("failed"));
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("reader session cannot satisfy owner login", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { role: "reader", expiresAt, manualId: null },
    }),
  );
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

for (const status of [401, 503]) {
  test(`list ${status} is not an empty workspace`, async ({ page }) => {
    await fixture(page, 200, status);
    await page.goto("/manuals");
    await expect(page.locator("[role=alert].error")).toBeVisible();
    await expect(page.getByText("아직 등록한 업무가 없습니다.")).toHaveCount(0);
    await expect(page.getByText("등록된 원본 자료가 없습니다.")).toHaveCount(0);
    await expect(page.getByText("계정과 문서 영구 삭제", { exact: true })).toHaveCount(0);
    if (status === 401) {
      await expect(page.getByRole("link", { name: "로그인 화면으로" })).toBeVisible();
      await expect(page.getByText(/Safari 또는 Chrome/)).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "시작 화면으로" })).toBeVisible();
      await expect(page.getByRole("button", { name: "문서함 다시 불러오기" })).toBeVisible();
    }
  });
}

test("authenticated empty list retains empty-state actions", async ({ page }) => {
  await fixture(page);
  await page.goto("/manuals");
  await expect(page.getByText("아직 등록한 업무가 없습니다.")).toBeVisible();
  await expect(page.getByRole("link", { name: "첫 자료 등록하기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "예제 불러오기" })).toBeVisible();
});

for (const status of [403, 503]) {
  test(`login then session ${status}: retry performs GET only`, async ({ page }) => {
    const calls = await fixture(page, status);
    await page.goto("/login");
    await submitLogin(page);
    await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
    await page.getByRole("button", { name: "세션 다시 확인" }).click();
    await expect.poll(() => calls.sessions).toBe(2);
    expect(calls.logins).toBe(1);
  });
}

test("an older owner session cannot satisfy a new login", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { role: "owner", expiresAt: "2098-01-01T00:00:00.000Z", manualId: null },
    }),
  );
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/login");
});
