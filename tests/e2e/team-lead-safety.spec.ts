import { expect, type Page, test } from "@playwright/test";

const teamId = "40000000-0000-4000-8000-000000000001";
const meId = "40000000-0000-4000-8000-000000000002";
const otherId = "40000000-0000-4000-8000-000000000003";
function team(ready = true) {
  return {
    id: teamId,
    name: "합성 이양 팀",
    role: "admin",
    leadReady: ready,
    members: [
      { id: meId, name: "합성 대표", department: null, role: "admin", lead: ready },
      { id: otherId, name: "합성 후임", department: null, role: "member", lead: false },
    ],
    invites: [],
  };
}
async function mockTeam(page: Page, value: () => ReturnType<typeof team>) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") throw new Error("Unexpected unmocked mutation");
    if (path === "/api/me")
      return route.fulfill({ json: { id: meId, name: "합성 대표", admin: false } });
    if (path === "/api/workspaces")
      return route.fulfill({
        json: [{ id: teamId, name: "합성 이양 팀", role: "admin", current: true }],
      });
    if (path.endsWith("/members")) return route.fulfill({ json: value() });
    throw new Error(`Unexpected request ${path}`);
  });
}

test("013 team keeps legacy labels and actions without offering lead transfer", async ({
  page,
}) => {
  await mockTeam(page, () => team(false));
  await page.goto(`/teams/${teamId}?tab=members`);
  await expect(page.getByRole("heading", { name: "합성 이양 팀", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "합성 후임 팀 관리자로 지정" })).toBeVisible();
  await expect(page.getByRole("button", { name: /관리자 넘기기/ })).toHaveCount(0);
  await expect(page.getByText("부관리자", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "팀 설정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "팀 문서함 삭제", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "팀 나가기", exact: true })).toBeEnabled();
});

test("lead transfer serializes confirmation and preserves selection after failure", async ({
  page,
}) => {
  await mockTeam(page, () => team());
  let writes = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/workspaces/${teamId}/lead`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ userId: otherId });
    writes++;
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: { code: "unavailable", message: "합성 이양 실패", retryable: false } },
    });
  });
  try {
    await page.goto(`/teams/${teamId}?tab=members`);
    await page.getByRole("button", { name: "합성 후임에게 관리자 넘기기", exact: true }).click();
    await page.getByRole("button", { name: "넘기기 확인", exact: true }).evaluate((element) => {
      for (let i = 0; i < 2; i++) element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => writes).toBe(1);
    release();
    await expect(page.getByRole("alert").filter({ hasText: "합성 이양 실패" })).toBeVisible();
    await expect(page.getByRole("button", { name: "넘기기 확인", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "취소", exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

test("lost lead permission refreshes controls without retrying the mutation", async ({ page }) => {
  const value = team();
  await mockTeam(page, () => value);
  let writes = 0;
  await page.route(`**/api/workspaces/${teamId}/lead`, async (route) => {
    writes++;
    value.members = value.members.map((member) => ({
      ...member,
      lead: member.id === otherId,
      role: member.id === otherId ? "admin" : member.role,
    }));
    await route.fulfill({
      status: 403,
      json: { error: { code: "lead_required", message: "합성 권한 변경", retryable: false } },
    });
  });
  await page.goto(`/teams/${teamId}?tab=members`);
  await page.getByRole("button", { name: "합성 후임에게 관리자 넘기기", exact: true }).click();
  await page.getByRole("button", { name: "넘기기 확인", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "합성 권한 변경" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /관리자 넘기기|부관리자로 지정|팀원으로 변경/ }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
});

test("unconfirmed transfer blocks resubmission until a read-only refresh succeeds", async ({
  page,
}) => {
  await mockTeam(page, () => team());
  let failedReads = false;
  let writes = 0;
  await page.route(`**/api/workspaces/${teamId}/members`, async (route) => {
    if (!failedReads) return route.fallback();
    await route.fulfill({
      status: 503,
      json: { error: { code: "unavailable", message: "합성 재조회 실패", retryable: false } },
    });
  });
  await page.route(`**/api/workspaces/${teamId}/lead`, async (route) => {
    writes++;
    failedReads = true;
    await route.fulfill({
      status: 503,
      json: { error: { code: "unavailable", message: "합성 결과 불명확", retryable: false } },
    });
  });
  await page.goto(`/teams/${teamId}?tab=members`);
  await page.getByRole("button", { name: "합성 후임에게 관리자 넘기기", exact: true }).click();
  await page.getByRole("button", { name: "넘기기 확인", exact: true }).click();
  const refresh = page.getByRole("button", { name: "권한 다시 확인", exact: true });
  await expect(refresh).toBeVisible();
  await expect(page.getByRole("button", { name: "넘기기 확인", exact: true })).toBeDisabled();
  failedReads = false;
  await refresh.click();
  await expect(page.getByRole("button", { name: "넘기기 확인", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
});
