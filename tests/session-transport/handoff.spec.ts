import { expect, type Page, test } from "@playwright/test";

async function submitLogin(page: Page) {
  await page.getByLabel("이메일").fill("a@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("correct horse 9");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

{
  test("login: prefetched and visited anonymous Next page accepts the new HTTPS cookie", async ({
    page,
    context,
  }) => {
    const offset = (await (await context.request.get("/__fixture/observations")).json()).length;
    await page.goto("/");
    await page.getByRole("link", { name: "문서함", exact: true }).hover();
    await page.getByRole("link", { name: "문서함", exact: true }).click();
    await expect(page.locator("[role=alert].error")).toBeVisible();
    await page.getByRole("link", { name: "로그인 화면으로", exact: true }).click();
    await submitLogin(page);
    await expect(page).toHaveURL(/\/manuals$/);
    await expect(page.getByText("아직 매뉴얼이 없습니다.")).toBeVisible();
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.name === "gm_owner" && cookie.httpOnly && cookie.secure,
      ),
    ).toBe(true);
    const response = await context.request.get("/__fixture/observations");
    const observations = (await response.json()).slice(offset);
    for (const path of ["/api/session", "/api/manuals", "/api/sources"]) {
      expect(
        observations.some(
          (entry: { path: string; status?: number; ownerPresent: boolean }) =>
            entry.path === path && entry.status === 200 && entry.ownerPresent,
        ),
      ).toBe(true);
    }
    expect(
      observations.some(
        (entry: { path: string; prefetch?: boolean; ownerPresent: boolean }) =>
          entry.path === "/manuals" && entry.prefetch && !entry.ownerPresent,
      ),
    ).toBe(true);
  });
}

test("login 200 with no Set-Cookie stays on login and retry is GET only", async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "missing-cookie" });
  let logins = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/login") logins++;
  });
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("login / 200 / success");
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 401 / http");
  await page.getByRole("button", { name: "세션 다시 확인" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(logins).toBe(1);
});

test("session200 then cookie loss is distinguished at document GET", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "drop-after-session" });
  await page.goto("/login");
  await submitLogin(page);
  await expect(page).toHaveURL(/\/manuals$/);
  await expect(page.locator("[role=alert].error")).toBeVisible();
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 200 / success");
  await expect(page.getByTestId("request-diagnostics")).toContainText("manuals / 401 / http");
  await expect(page.getByText("아직 매뉴얼이 없습니다.")).toHaveCount(0);
});

test("session503 is distinguished from lost credentials", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "session-unavailable" });
  await page.goto("/login");
  await submitLogin(page);
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 503 / http");
});

test("session timeout preserves login success without another POST", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "session-timeout" });
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByText("오류 진단", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("login / 200 / success");
  await expect(page.getByTestId("request-diagnostics")).toContainText(
    "session / no-response / timeout",
  );
});

test("a new login discards the previous request diagnostics", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "drop-after-session" });
  await page.goto("/login");
  await submitLogin(page);
  await expect(page.getByRole("link", { name: "로그인 화면으로", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "로그인 화면으로", exact: true }).click();
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "missing-cookie" });
  await submitLogin(page);
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 401 / http");
  await expect(page.getByTestId("request-diagnostics")).not.toContainText("manuals");
  await expect(page.getByTestId("request-diagnostics")).not.toContainText("sources");
});
