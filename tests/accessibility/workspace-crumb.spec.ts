import { expect, test } from "@playwright/test";
import { source } from "./design-data";

test("long team breadcrumb and administrator navigation stay keyboard accessible without overflow", async ({
  page,
}, testInfo) => {
  const id = "20000000-0000-4000-8000-000000000001";
  const name = "가".repeat(40);
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") throw new Error("Read-only breadcrumb audit");
    const path = new URL(route.request().url()).pathname;
    const values: Record<string, unknown> = {
      "/api/me": { name: "합성 관리자", admin: true },
      "/api/session": { role: "owner" },
      "/api/templates": [],
      "/api/workspaces": [{ id, name, role: "admin", current: true }],
      [`/api/sources/${source.id}`]: source,
      [`/api/sources/${source.id}/history`]: [],
    };
    if (!(path in values)) throw new Error(`Unexpected breadcrumb audit request: ${path}`);
    await route.fulfill({ json: values[path] });
  });
  await page.goto(`/sources/${source.id}`);
  await expect(
    page.getByRole("heading", { name: source.title, level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  const crumb = page.locator(".crumb");
  await expect(crumb.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(crumb.getByRole("link", { name, exact: true })).toHaveAttribute(
    "href",
    `/teams/${id}`,
  );
  const navigation = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  await expect(navigation.getByRole("link", { name: "관리자", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "내 문서함", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "도움말", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "관리자", exact: true })).toBeFocused();
  await crumb.getByRole("link", { name: "내 문서함", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(crumb.getByRole("link", { name, exact: true })).toBeFocused();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("team-hub.png"), fullPage: true });
});
