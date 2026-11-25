import { expect, test } from "@playwright/test";

const teamId = "41000000-0000-4000-8000-000000000001";
const meId = "41000000-0000-4000-8000-000000000002";
const otherId = "41000000-0000-4000-8000-000000000003";
test("lead confirmation supports keyboard cancellation and completion focus", async ({
  page,
}, testInfo) => {
  let transferred = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/lead") && route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ userId: otherId });
      transferred = true;
      return route.fulfill({ json: { id: teamId, leadUserId: otherId } });
    }
    if (route.request().method() !== "GET") throw new Error("Unexpected synthetic write");
    if (path === "/api/me")
      return route.fulfill({ json: { id: meId, name: "합성 대표", admin: false } });
    if (path === "/api/workspaces")
      return route.fulfill({
        json: [{ id: teamId, name: "합성 이양 팀", role: "admin", current: true }],
      });
    if (path.endsWith("/members"))
      return route.fulfill({
        json: {
          id: teamId,
          name: "합성 이양 팀",
          role: "admin",
          leadReady: true,
          invites: [],
          members: [
            { id: meId, name: "합성 대표", role: "admin", department: null, lead: !transferred },
            {
              id: otherId,
              name: "합성 후임",
              role: transferred ? "admin" : "member",
              department: null,
              lead: transferred,
            },
          ],
        },
      });
    throw new Error(`Unexpected ${path}`);
  });
  await page.goto(`/teams/${teamId}?tab=members`);
  const start = page.getByRole("button", { name: "합성 후임에게 관리자 넘기기", exact: true });
  await start.focus();
  await start.press("Enter");
  const confirm = page.getByRole("button", { name: "넘기기 확인", exact: true });
  await expect(confirm).toBeFocused();
  await confirm.press("Tab");
  const cancel = page.getByRole("button", { name: "취소", exact: true });
  await expect(cancel).toBeFocused();
  await cancel.press("Enter");
  await expect(start).toBeFocused();
  await start.press("Enter");
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");
  const heading = page.getByRole("heading", { name: "합성 이양 팀", level: 1 });
  await expect(heading).toBeFocused();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "합성 대표" })
      .getByText("부관리자", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("team-hub.png"), fullPage: true });
});
