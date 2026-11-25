import { expect, test } from "@playwright/test";

const teamId = "50000000-0000-4000-8000-000000000001";
const userId = "50000000-0000-4000-8000-000000000002";
const work = {
  id: "50000000-0000-4000-8000-000000000003",
  title: "첫 진행 업무",
  manualTitle: null,
  createdByName: "합성 담당자",
  revision: 1,
  revisionAt: "2026-11-25T00:00:00.000Z",
  openQuestions: 0,
  manualId: null,
  publishedVersion: null,
  needsReview: false,
  unpublishedChanges: false,
};

test("progress replaces pages, serializes requests and retains the failed page for retry", async ({
  page,
}) => {
  let reads = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") throw new Error("Progress audit must not write");
    const values: Record<string, unknown> = {
      "/api/me": { id: userId, name: "합성 담당자", admin: false },
      "/api/workspaces": [{ id: teamId, name: "합성 진행 팀", role: "admin", current: true }],
      [`/api/workspaces/${teamId}/members`]: {
        id: teamId,
        name: "합성 진행 팀",
        role: "admin",
        leadReady: false,
        members: [{ id: userId, name: "합성 담당자", department: null, role: "admin" }],
        invites: [],
      },
      "/api/manuals": [],
      "/api/sources": [],
      "/api/templates": [],
    };
    if (url.pathname === `/api/workspaces/${teamId}/progress`) {
      if (url.searchParams.has("afterWork")) {
        reads++;
        await gate;
        if (reads === 1)
          return route.fulfill({
            status: 503,
            json: {
              error: { code: "unavailable", message: "합성 진행 조회 실패", retryable: false },
            },
          });
        return route.fulfill({
          json: { works: [{ ...work, title: "마지막 진행 업무" }], total: 11, nextCursor: null },
        });
      }
      return route.fulfill({ json: { works: [work], total: 11, nextCursor: "next-work" } });
    }
    if (!(url.pathname in values)) throw new Error(`Unexpected path ${url.pathname}`);
    await route.fulfill({ json: values[url.pathname] });
  });
  try {
    await page.goto(`/teams/${teamId}?tab=progress`);
    await expect(page.getByRole("rowheader", { name: "첫 진행 업무", exact: true })).toBeVisible();
    const next = page.getByRole("button", { name: "다음 업무", exact: true });
    await next.evaluate((element) => {
      for (let i = 0; i < 2; i++) element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => reads).toBe(1);
    release();
    await expect(page.getByRole("alert").filter({ hasText: "합성 진행 조회 실패" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "첫 진행 업무", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
    await expect(
      page.getByRole("rowheader", { name: "마지막 진행 업무", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "첫 진행 업무", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "진행 현황", exact: true })).toBeFocused();
    expect(reads).toBe(2);
    const first = page.getByRole("button", { name: "처음 업무", exact: true });
    await first.press("Enter");
    await expect(page.getByRole("rowheader", { name: "첫 진행 업무", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    release();
  }
});
