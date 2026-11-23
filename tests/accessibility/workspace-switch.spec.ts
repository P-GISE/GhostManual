import { expect, test } from "@playwright/test";

test("workspace selector fits the navigation with a long team name and admin controls", async ({
  page,
}, testInfo) => {
  const personalId = "30000000-0000-4000-8000-000000000001";
  const teamId = "30000000-0000-4000-8000-000000000002";
  const name = "합성".repeat(20);
  const values: Record<string, unknown> = {
    "/api/me": { name: "합성 관리자", admin: true },
    "/api/workspaces": [
      { id: personalId, name: null, role: null, current: false },
      { id: teamId, name, role: "admin", current: true },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") throw new Error("Workspace layout audit must not write");
    if (!(path in values)) throw new Error(`Unexpected workspace audit request: ${path}`);
    await route.fulfill({ json: values[path] });
  });
  await page.goto("/teams");
  const navigation = page.getByRole("navigation", { name: "주 메뉴" });
  const select = navigation.getByRole("combobox", { name: "문서함 전환" });
  await expect(select).toHaveValue(teamId);
  await expect(select.getByRole("option")).toHaveCount(2);
  const admin = navigation.getByRole("link", { name: "관리자", exact: true });
  await expect(admin).toBeVisible();
  await expect(navigation.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await select.focus();
  await expect(select).toBeFocused();
  await select.press("Tab");
  await expect(admin).toBeFocused();

  const bounds = await select.boundingBox();
  const menu = await navigation.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  console.log(JSON.stringify({ viewport, selector: bounds, navigation: menu }));
  await page.screenshot({ path: testInfo.outputPath("team-hub.png"), fullPage: true });
  expect(bounds).not.toBeNull();
  expect(menu).not.toBeNull();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    (menu?.x ?? 0) + (menu?.width ?? 0) + 1,
  );
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.width);
});
