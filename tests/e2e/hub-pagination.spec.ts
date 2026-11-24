import { expect, test } from "@playwright/test";
import {
  filteredHub,
  hubOverview,
  hubPersonalId,
  hubTeamId,
  hubWork,
} from "../fixtures/hub-overview";

const otherId = "30000000-0000-4000-8000-000000000005";

test("library replaces team/work pages and searches across unloaded teams", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") throw new Error("Paging must not write");
    let body: unknown;
    if (url.pathname === "/api/me") body = { name: "합성 담당자", admin: false };
    else if (url.pathname === "/api/workspaces")
      body = [{ id: hubPersonalId, name: null, role: null, current: true }];
    else if (url.pathname === "/api/overview") {
      requests.push(url);
      const view = hubOverview();
      view.teams[0].workCount = 11;
      view.teams[0].matchingCount = 11;
      body = {
        ...view,
        counts: { all: 12, todo: 12, published: 0 },
        nextTeamCursor: hubTeamId,
        teams: [{ ...view.teams[0], nextWorkCursor: "next-work" }],
      };
      if (url.searchParams.has("workspaceId"))
        body = {
          ...view,
          teams: [{ ...view.teams[0], works: [{ ...hubWork, title: "마지막 페이지 업무" }] }],
        };
      else if (url.searchParams.has("afterTeam") || url.searchParams.get("query") === "마지막 팀")
        body = {
          ...view,
          nextTeamCursor: null,
          teams: [
            {
              ...view.teams[0],
              id: otherId,
              name: "마지막 팀",
              works: [{ ...hubWork, title: "마지막 팀 업무" }],
            },
          ],
        };
    } else throw new Error(`Unexpected read ${url.pathname}`);
    await route.fulfill({ json: body });
  });
  await page.goto("/library");
  const first = page.getByRole("region", { name: "합성 업무 팀" });
  await first.getByRole("button", { name: "다음 업무", exact: true }).click();
  await expect(first.getByRole("link", { name: "마지막 페이지 업무", exact: true })).toBeVisible();
  await expect(first.getByRole("link", { name: hubWork.title, exact: true })).toHaveCount(0);
  expect(requests.at(-1)?.searchParams.get("workspaceId")).toBe(hubTeamId);
  expect(requests.at(-1)?.searchParams.get("afterWork")).toBe("next-work");
  await first.getByRole("button", { name: "처음 업무", exact: true }).click();
  await expect(first.getByRole("link", { name: hubWork.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음 문서함", exact: true }).click();
  await expect(page.getByRole("region", { name: "마지막 팀", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "합성 업무 팀", exact: true })).toHaveCount(0);
  expect(requests.at(-1)?.searchParams.get("afterTeam")).toBe(hubTeamId);
  await page.getByRole("button", { name: "이전 문서함", exact: true }).click();
  await expect(first).toBeVisible();
  await page.getByLabel("업무 검색").fill("마지막 팀");
  await expect(page.getByRole("region", { name: "마지막 팀", exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("afterTeam")).toBeNull();
});

test("library ignores late searches and retains failed input for retry", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") throw new Error("Search must not write");
    if (url.pathname === "/api/me")
      return route.fulfill({ json: { name: "합성 담당자", admin: false } });
    if (url.pathname === "/api/workspaces") return route.fulfill({ json: [] });
    if (url.pathname !== "/api/overview") throw new Error("Unexpected read");
    const query = url.searchParams.get("query");
    if (query === "느린 검색") await gate;
    if (query === "실패 검색" && fail)
      return route.fulfill({
        status: 503,
        json: { error: { code: "unavailable", message: "합성 조회 실패", retryable: false } },
      });
    const view = hubOverview();
    view.teams[0].name = query || "합성 업무 팀";
    await route.fulfill({ json: query ? view : filteredHub(url.href, view) });
  });
  try {
    await page.goto("/library");
    const search = page.getByLabel("업무 검색");
    await search.fill("느린 검색");
    await page.waitForRequest(
      (request) => new URL(request.url()).searchParams.get("query") === "느린 검색",
    );
    await search.fill("빠른 검색");
    await expect(page.getByRole("region", { name: "빠른 검색", exact: true })).toBeVisible();
    release();
    await expect(page.getByRole("region", { name: "느린 검색", exact: true })).toHaveCount(0);
    await search.fill("실패 검색");
    await expect(page.getByRole("alert").filter({ hasText: "합성 조회 실패" })).toBeVisible();
    await expect(search).toHaveValue("실패 검색");
    await expect(page.getByRole("region", { name: "빠른 검색", exact: true })).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
    await expect(page.getByRole("region", { name: "실패 검색", exact: true })).toBeVisible();
  } finally {
    release();
  }
});
