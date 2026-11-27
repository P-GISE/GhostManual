import { expect, type Page, test } from "@playwright/test";
import { filteredHub, hubOverview, hubPersonalId, hubTeamId } from "../fixtures/hub-overview";

const createdId = "30000000-0000-4000-8000-000000000099";
const failure = { error: { code: "unavailable", message: "합성 요청 실패", retryable: false } };

async function mockHub(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const values: Record<string, unknown> = {
      "/api/me": { name: "합성 담당자", admin: false },
      "/api/workspaces": [
        { id: hubTeamId, name: "합성 업무 팀", role: "admin", current: true },
        { id: hubPersonalId, name: null, role: null, current: false },
      ],
      "/api/overview": filteredHub(route.request().url(), hubOverview()),
    };
    if (route.request().method() !== "GET") throw new Error("Unexpected unmocked write");
    await route.fulfill({ status: path in values ? 200 : 404, json: values[path] ?? failure });
  });
}

async function openCreate(page: Page) {
  await page.goto("/library");
  await page.getByRole("button", { name: "팀 만들기", exact: true }).click();
  await page.getByLabel("팀 이름", { exact: true }).fill("합성 새 팀");
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("team creation draft survives search and status filter refresh", async ({ page }) => {
  await mockHub(page);
  await openCreate(page);
  await page.getByLabel("업무 검색").fill("합성");
  await expect(page.getByRole("link", { name: "합성 팀 업무", exact: true })).toBeVisible();
  await expect(page.getByLabel("팀 이름", { exact: true })).toHaveValue("합성 새 팀");
  await page.getByRole("button", { name: "게시됨 0", exact: true }).click();
  await expect(page.getByText("조건에 맞는 업무가 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("팀 이름", { exact: true })).toHaveValue("합성 새 팀");
});

test("team creation serializes duplicate activation and reconciles unknown create outcome", async ({
  page,
}) => {
  await mockHub(page);
  let creates = 0;
  const gate = deferred();
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    creates++;
    await gate.promise;
    await route.fulfill({ status: 503, json: failure });
  });
  try {
    await openCreate(page);
    await page.getByRole("button", { name: "팀 문서함 만들기", exact: true }).evaluate((button) => {
      for (let i = 0; i < 2; i++) button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => creates).toBe(1);
    gate.resolve();
    await expect(page.getByRole("alert").filter({ hasText: "합성 요청 실패" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "팀 문서함 만들기", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "내 문서함에서 생성 결과 확인", exact: true }),
    ).toHaveAttribute("href", "/library");
    expect(creates).toBe(1);
  } finally {
    gate.resolve();
  }
});

test("acknowledged creation retries only session switching after its failure", async ({ page }) => {
  await mockHub(page);
  let creates = 0;
  let switches = 0;
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    creates++;
    await route.fulfill({ json: { id: createdId } });
  });
  await page.route("**/api/session/workspace", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ workspaceId: createdId });
    switches++;
    await route.fulfill({ status: 503, json: failure });
  });
  await openCreate(page);
  await page.getByRole("button", { name: "팀 문서함 만들기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "합성 요청 실패" })).toBeVisible();
  await expect(page.getByLabel("팀 이름", { exact: true })).toHaveValue("합성 새 팀");
  await page.getByRole("button", { name: "만든 팀으로 다시 이동", exact: true }).click();
  await expect.poll(() => switches).toBe(2);
  expect(creates).toBe(1);
  await expect(page).toHaveURL(/\/library$/);
});

test("leaving while creation is pending prevents a later session switch or forced navigation", async ({
  page,
}) => {
  await mockHub(page);
  const gate = deferred();
  let creates = 0;
  let switches = 0;
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    creates++;
    await gate.promise;
    await route.fulfill({ json: { id: createdId } });
  });
  await page.route("**/api/session/workspace", async (route) => {
    switches++;
    await route.fulfill({ json: { ok: true } });
  });
  try {
    await openCreate(page);
    await page.getByRole("button", { name: "팀 문서함 만들기", exact: true }).click();
    await expect.poll(() => creates).toBe(1);
    // Next Link navigation unmounts the form without aborting its pending HTTP callback.
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "도움말", exact: true })
      .click();
    await expect(page).toHaveURL(/\/help$/);
    const response = page.waitForResponse(
      (value) =>
        value.request().method() === "POST" && new URL(value.url()).pathname === "/api/workspaces",
    );
    gate.resolve();
    await (await response).finished();
    await page.waitForTimeout(500);
    expect(switches).toBe(0);
    await expect(page).toHaveURL(/\/help$/);
  } finally {
    gate.resolve();
  }
});

test("successful overview refresh removes an earlier signed-out hint", async ({ page }) => {
  await mockHub(page);
  await page.route("**/api/overview?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    await route.fulfill(
      query
        ? { json: filteredHub(route.request().url(), hubOverview()) }
        : {
            status: 401,
            json: {
              error: { code: "unauthorized", message: "로그인이 필요합니다.", retryable: false },
            },
          },
    );
  });
  await page.goto("/library");
  await expect(page.getByRole("link", { name: "로그인 화면으로", exact: true })).toBeVisible();
  await page.getByLabel("업무 검색").fill("합성");
  await expect(page.getByRole("link", { name: "합성 팀 업무", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인 화면으로", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("이 브라우저에서 로그인 상태를 확인할 수 없습니다.", { exact: false }),
  ).toHaveCount(0);
});

test("pending team creation prevents a competing Hub session switch", async ({ page }) => {
  await mockHub(page);
  const gate = deferred();
  let creates = 0;
  let switches = 0;
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    creates++;
    await gate.promise;
    await route.fulfill({ status: 503, json: failure });
  });
  await page.route("**/api/session/workspace", async (route) => {
    switches++;
    await route.fulfill({ status: 503, json: failure });
  });
  try {
    await openCreate(page);
    await page.getByRole("button", { name: "팀 문서함 만들기", exact: true }).click();
    await expect.poll(() => creates).toBe(1);
    const work = page.getByRole("link", { name: "합성 팀 업무", exact: true });
    await expect(work).toHaveAttribute("aria-disabled", "true");
    await work.dispatchEvent("click");
    for (const name of ["합성 업무 팀", "합성 업무 팀 팀원 초대", "합성 업무 팀 팀 화면 열기"]) {
      const link = page.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("aria-disabled", "true");
      await link.dispatchEvent("click");
    }
    await page.waitForTimeout(300);
    expect(switches).toBe(0);
    await expect(page).toHaveURL(/\/library$/);
    gate.resolve();
    await expect(page.getByRole("alert").filter({ hasText: "합성 요청 실패" })).toBeVisible();
    await expect(work).toHaveAttribute("aria-disabled", "false");
  } finally {
    gate.resolve();
  }
});
