import { expect, test } from "@playwright/test";

const home = "52000000-0000-4000-8000-000000000001";
const first = "52000000-0000-4000-8000-000000000002";
const second = "52000000-0000-4000-8000-000000000003";
test("blocked deletion announcement and transfer links support keyboard and narrow layouts", async ({
  page,
}, testInfo) => {
  let deletes = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me" && request.method() === "DELETE") {
      deletes++;
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "lead_transfer_required",
            message: "대표 권한을 먼저 이양하세요.",
            retryable: false,
          },
        },
      });
    }
    if (request.method() !== "GET") throw new Error("Unexpected write during keyboard test");
    if (path === "/api/me")
      return route.fulfill({
        json: {
          id: home,
          name: "합성 담당자",
          email: "synthetic@example.invalid",
          admin: false,
          department: null,
          loginMethods: ["password"],
          usage: { bytes: 0, limitBytes: 1000000 },
        },
      });
    if (path === "/api/workspaces")
      return route.fulfill({
        json: [
          { id: home, name: null, role: null, current: true, lead: false },
          {
            id: first,
            name: "SyntheticRepresentativeTransferTeamLongX",
            role: "admin",
            current: false,
            lead: true,
          },
          { id: second, name: "두 번째 합성 대표 팀", role: "admin", current: false, lead: true },
        ],
      });
    throw new Error(`Unexpected keyboard request ${path}`);
  });
  await page.goto("/account");
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("합성 담당자");
  await page.getByRole("tab", { name: "설정", exact: true }).press("Enter");
  await page.getByLabel("삭제할 내용을 확인했습니다.").check();
  await page.getByRole("button", { name: "계정과 문서 영구 삭제", exact: true }).press("Enter");
  const region = page.getByRole("region", { name: "대표 권한 이양 안내" });
  const heading = region.getByRole("heading", {
    name: "대표 권한을 먼저 이양해 주세요",
    exact: true,
  });
  await expect(heading).toBeFocused();
  await heading.press("Tab");
  const firstLink = region.getByRole("link", {
    name: "SyntheticRepresentativeTransferTeamLongX 대표 이양",
  });
  await expect(firstLink).toBeFocused();
  await expect(firstLink).toHaveAttribute("href", `/teams/${first}?tab=members`);
  await firstLink.press("Tab");
  await expect(region.getByRole("link", { name: "두 번째 합성 대표 팀 대표 이양" })).toBeFocused();
  await expect(page.getByLabel("삭제할 내용을 확인했습니다.")).not.toBeChecked();
  expect(deletes).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({ path: testInfo.outputPath("team-hub.png"), fullPage: true });
});
