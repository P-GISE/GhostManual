import { expect, test } from "@playwright/test";
import { hubOverview, hubPersonalId, hubTeamId } from "../fixtures/hub-overview";

for (const ready of [false, true]) {
  test(`library role labels, personal entry and keyboard filters (ready: ${ready})`, async ({
    page,
  }, testInfo) => {
    const values: Record<string, unknown> = {
      "/api/me": { name: "합성 담당자", admin: false },
      "/api/workspaces": [
        { id: hubTeamId, name: "합성 업무 팀", role: "admin", current: true },
        { id: hubPersonalId, name: null, role: null, current: false },
      ],
      "/api/overview": hubOverview(ready, true),
    };
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET") throw new Error("Library accessibility audit must not write");
      if (!(path in values)) throw new Error(`Unexpected library audit request: ${path}`);
      await route.fulfill({ json: values[path] });
    });
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "내 문서함", level: 1 })).toBeVisible();
    const team = page.getByRole("region", { name: "합성 업무 팀" });
    await expect(team.getByText(ready ? "관리자" : "팀 관리자", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "개인 업무" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "개인 문서함에 업무 등록", exact: true }),
    ).toBeVisible();
    const search = page.getByLabel("업무 검색");
    await search.focus();
    await search.press("Tab");
    const all = page.getByRole("button", { name: "전체 2", exact: true });
    await expect(all).toBeFocused();
    await expect(all).toHaveAttribute("aria-pressed", "true");
    const published = page.getByRole("button", { name: "게시됨 0", exact: true });
    await published.focus();
    await published.press("Enter");
    await expect(published).toHaveAttribute("aria-pressed", "true");
    await expect(team.getByText("조건에 맞는 업무가 없습니다.", { exact: true })).toBeVisible();
    await search.fill("찾을 수 없는 합성 업무");
    await expect(search).toHaveValue("찾을 수 없는 합성 업무");
    for (const button of await page
      .getByRole("group", { name: "상태로 거르기" })
      .getByRole("button")
      .all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("team-hub.png"), fullPage: true });
  });
}
