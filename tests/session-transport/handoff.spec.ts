import { expect, test } from "@playwright/test";

for (const label of ["빈 공간 시작", "합성 예제 열기"]) {
  test(`${label}: prefetched and visited anonymous Next page accepts the new HTTPS cookie`, async ({
    page,
    context,
  }) => {
    const offset = (await (await context.request.get("/__fixture/observations")).json()).length;
    await page.goto("/");
    await page.getByRole("link", { name: "문서함", exact: true }).hover();
    await page.getByRole("link", { name: "문서함", exact: true }).click();
    await expect(page.locator("[role=alert].error")).toBeVisible();
    await page.getByRole("link", { name: "시작 화면으로", exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
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

test("POST201 with no Set-Cookie stays home and retry is GET only", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "missing-cookie" });
  let creates = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/workspaces") creates++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "세션 다시 확인" })).toBeVisible();
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("create / 201 / success");
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 401 / http");
  await page.getByRole("button", { name: "세션 다시 확인" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(creates).toBe(1);
});

test("session200 then cookie loss is distinguished at document GET", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "drop-after-session" });
  await page.goto("/");
  await page.getByRole("button", { name: "합성 예제 열기", exact: true }).click();
  await expect(page).toHaveURL(/\/manuals$/);
  await expect(page.locator("[role=alert].error")).toBeVisible();
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 200 / success");
  await expect(page.getByTestId("request-diagnostics")).toContainText("manuals / 401 / http");
  await expect(page.getByText("아직 매뉴얼이 없습니다.")).toHaveCount(0);
});

test("session503 is distinguished from lost credentials", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "session-unavailable" });
  await page.goto("/");
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 503 / http");
});

test("session timeout preserves creation success without another POST", async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "session-timeout" });
  await page.goto("/");
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await expect(page.getByText("오류 진단", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("create / 201 / success");
  await expect(page.getByTestId("request-diagnostics")).toContainText(
    "session / no-response / timeout",
  );
});

test("a new start discards the previous workspace request diagnostics", async ({
  page,
  context,
}) => {
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "drop-after-session" });
  await page.goto("/");
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await expect(page.getByRole("link", { name: "시작 화면으로", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "시작 화면으로", exact: true }).click();
  await context.setExtraHTTPHeaders({ "x-fixture-scenario": "missing-cookie" });
  await page.getByRole("button", { name: "빈 공간 시작", exact: true }).click();
  await page.getByText("오류 진단", { exact: true }).click();
  await expect(page.getByTestId("request-diagnostics")).toContainText("session / 401 / http");
  await expect(page.getByTestId("request-diagnostics")).not.toContainText("manuals");
  await expect(page.getByTestId("request-diagnostics")).not.toContainText("sources");
});
