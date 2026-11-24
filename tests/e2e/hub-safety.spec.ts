import { expect, type Page, test } from "@playwright/test";
import { hubOverview, hubPersonalId, hubTeamId, hubWork } from "../fixtures/hub-overview";

async function mockHub(page: Page, overview: unknown) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const values: Record<string, unknown> = {
      "/api/me": { name: "합성 담당자", admin: false },
      "/api/workspaces": [
        { id: hubTeamId, name: "합성 업무 팀", role: "admin", current: true },
        { id: hubPersonalId, name: null, role: null, current: false },
      ],
      "/api/overview": overview,
    };
    if (route.request().method() !== "GET") throw new Error("Unexpected unmocked write");
    if (!(path in values)) {
      await route.fulfill({
        status: 404,
        json: { error: { code: "not_found", message: "합성 대상 없음", retryable: false } },
      });
      return;
    }
    await route.fulfill({ json: values[path] });
  });
}

test("hub rechecks a cached-current task and serializes repeated navigation while retaining failed input", async ({
  page,
}) => {
  await mockHub(page, hubOverview());
  let calls = 0;
  let resume = () => {};
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route("**/api/session/workspace", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ workspaceId: hubTeamId });
    calls++;
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: { code: "unavailable", message: "합성 전환 실패", retryable: false } },
    });
  });
  try {
    await page.goto("/library");
    await page.getByLabel("업무 검색").fill("합성");
    await page.getByRole("button", { name: "내가 할 일 1", exact: true }).click();
    await page.getByRole("link", { name: hubWork.title, exact: true }).evaluate((element) => {
      for (let count = 0; count < 2; count++)
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await expect.poll(() => calls, { timeout: 2000 }).toBe(1);
    await expect(page.getByRole("status")).toHaveText("문서함을 전환하고 있습니다.");
    resume();
    await expect(page.getByRole("alert").filter({ hasText: "합성 전환 실패" })).toHaveText(
      "합성 전환 실패",
    );
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByLabel("업무 검색")).toHaveValue("합성");
    await expect(page.getByRole("button", { name: "내가 할 일 1", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("link", { name: hubWork.title, exact: true }).click();
    await expect.poll(() => calls).toBe(2);
  } finally {
    resume();
  }
});

test("hub keeps personal registration available and does not classify current personal work as legacy", async ({
  page,
}) => {
  await mockHub(page, { teams: [], personal: null });
  await page.goto("/library");
  await expect(
    page.getByRole("link", { name: "개인 문서함에 업무 등록", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/**");
  await mockHub(page, hubOverview(false, true));
  await page.reload();
  await expect(page.getByRole("heading", { name: "개인 업무", exact: true })).toBeVisible();
  await expect(page.getByText("팀을 만들기 전에 올린 업무입니다.", { exact: false })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "합성 개인 업무", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "개인 문서함에 업무 등록", exact: true }),
  ).toBeVisible();
});
