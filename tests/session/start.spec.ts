import { expect, type Page, test } from "@playwright/test";

const expiresAt = "2099-01-01T00:00:00.000Z";
async function fixture(page: Page, sessionStatus = 200, listStatus = 200) {
  const calls = { creates: 0, sessions: 0 };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/workspaces") {
      calls.creates++;
      await route.fulfill({ status: 201, json: { expiresAt } });
    } else if (path === "/api/session") {
      calls.sessions++;
      await route.fulfill({
        status: sessionStatus,
        json:
          sessionStatus === 200
            ? { role: "owner", expiresAt, manualId: null }
            : { error: { message: "작업 공간을 다시 시작하세요." } },
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

for (const label of ["빈 공간 시작", "합성 예제 열기"]) {
  test(`${label}: session round-trip precedes document navigation`, async ({ page }) => {
    const calls = await fixture(page);
    await page.goto("/");
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(/\/manuals$/);
    expect(calls.sessions).toBe(1);
    expect(calls.creates).toBe(1);
  });
}

test("201 then missing session stays home; retry checks session without another POST", async ({
  page,
}) => {
  const calls = await fixture(page, 401);
  await page.goto("/");
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[role=alert].error")).toContainText("세션");
  await expect(page.getByText(/Safari 또는 Chrome/)).toBeVisible();
  await page.getByRole("button", { name: "세션 다시 확인" }).click();
  await expect.poll(() => calls.sessions).toBe(2);
  expect(calls.creates).toBe(1);
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { role: "owner", expiresAt, manualId: null },
    }),
  );
  await page.getByRole("button", { name: "세션 다시 확인" }).click();
  await expect(page).toHaveURL(/\/manuals$/);
  expect(calls.creates).toBe(1);
});

test("session transport failure stays home", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/session", (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("button", { name: "합성 예제 열기", exact: true }).click();
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("reader session cannot satisfy owner startup", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { role: "reader", expiresAt, manualId: null },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

for (const status of [401, 503]) {
  test(`list ${status} is not an empty workspace`, async ({ page }) => {
    await fixture(page, 200, status);
    await page.goto("/manuals");
    await expect(page.locator("[role=alert].error")).toBeVisible();
    await expect(page.getByText("아직 매뉴얼이 없습니다.")).toHaveCount(0);
    await expect(page.getByText("등록된 원본 자료가 없습니다.")).toHaveCount(0);
    await expect(page.getByText("작업 공간 영구 삭제", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "시작 화면으로" })).toBeVisible();
    if (status === 401) await expect(page.getByText(/Safari 또는 Chrome/)).toBeVisible();
    else await expect(page.getByRole("button", { name: "문서함 다시 불러오기" })).toBeVisible();
  });
}

test("authenticated empty list retains empty-state actions", async ({ page }) => {
  await fixture(page);
  await page.goto("/manuals");
  await expect(page.getByText("아직 매뉴얼이 없습니다.")).toBeVisible();
  await expect(page.getByRole("link", { name: "첫 자료 등록하기" })).toBeVisible();
});

for (const status of [403, 503]) {
  test(`201 then session ${status}: retry performs GET only`, async ({ page }) => {
    const calls = await fixture(page, status);
    await page.goto("/");
    await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
    await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    await page.getByRole("button", { name: "세션 다시 확인" }).click();
    await expect.poll(() => calls.sessions).toBe(2);
    expect(calls.creates).toBe(1);
  });
}

test("an older owner session cannot satisfy new workspace startup", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { role: "owner", expiresAt: "2098-01-01T00:00:00.000Z", manualId: null },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});
