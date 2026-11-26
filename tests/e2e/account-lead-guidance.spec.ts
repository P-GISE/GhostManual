import { expect, type Page, test } from "@playwright/test";

const ids = {
  home: "51000000-0000-4000-8000-000000000001",
  first: "51000000-0000-4000-8000-000000000002",
  second: "51000000-0000-4000-8000-000000000003",
  member: "51000000-0000-4000-8000-000000000004",
  deputy: "51000000-0000-4000-8000-000000000005",
};
const workspaces = [
  { id: ids.home, name: null, role: null, current: false, lead: false },
  { id: ids.first, name: "합성 대표 A", role: "admin", current: false, lead: true },
  { id: ids.second, name: "합성 대표 B", role: "admin", current: false, lead: true },
  { id: ids.member, name: "참여 중인 팀", role: "member", current: true, lead: false },
  { id: ids.deputy, name: "다른 사람의 대표 팀", role: "admin", current: false, lead: false },
];
type State = {
  deletes: number;
  deleteStatus: number;
  lookups: number;
  code: string;
  lookupStatus: number;
  body: unknown;
  releaseDelete?: Promise<void>;
};
async function setup(page: Page) {
  const state: State = {
    deletes: 0,
    deleteStatus: 409,
    lookups: 0,
    code: "lead_transfer_required",
    lookupStatus: 200,
    body: workspaces,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me" && request.method() === "DELETE") {
      state.deletes++;
      await state.releaseDelete;
      return route.fulfill({
        status: state.deleteStatus,
        json: {
          error: {
            code: state.code,
            message: "대표 권한을 이양한 뒤 진행하세요.",
            retryable: false,
          },
        },
      });
    }
    if (request.method() !== "GET") throw new Error("Unexpected account mutation");
    if (path === "/api/me")
      return route.fulfill({
        json: {
          id: "51000000-0000-4000-8000-000000000006",
          name: "합성 사용자",
          email: "synthetic@example.invalid",
          admin: false,
          department: null,
          loginMethods: ["password"],
          usage: { bytes: 0, limitBytes: 1000000 },
        },
      });
    if (path === "/api/workspaces") {
      if (state.deletes) state.lookups++;
      return route.fulfill({
        status: state.deletes ? state.lookupStatus : 200,
        json: state.deletes ? state.body : workspaces,
      });
    }
    throw new Error(`Unexpected account request ${path}`);
  });
  await page.goto("/account");
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("합성 사용자");
  await page.getByRole("tab", { name: "설정", exact: true }).click();
  await page.getByLabel("삭제할 내용을 확인했습니다.").check();
  return state;
}
const notice = (page: Page) => page.getByRole("region", { name: "대표 권한 이양 안내" });
const remove = (page: Page) =>
  page.getByRole("button", { name: "계정과 문서 영구 삭제", exact: true });

test("a blocked deletion shows all own led teams without switching or deleting automatically", async ({
  page,
}) => {
  const state = await setup(page);
  state.body = workspaces.map((team) => (team.role === "member" ? { ...team, lead: true } : team));
  await remove(page).click();
  await expect(notice(page)).toBeVisible({ timeout: 3000 });
  await expect(notice(page).getByRole("link", { name: "합성 대표 A 대표 이양" })).toHaveAttribute(
    "href",
    `/teams/${ids.first}?tab=members`,
  );
  await expect(notice(page).getByRole("link", { name: "합성 대표 B 대표 이양" })).toHaveAttribute(
    "href",
    `/teams/${ids.second}?tab=members`,
  );
  await expect(notice(page).getByText("참여 중인 팀")).toHaveCount(0);
  await expect(notice(page).getByText("다른 사람의 대표 팀")).toHaveCount(0);
  await expect(page.getByLabel("삭제할 내용을 확인했습니다.")).not.toBeChecked();
  await expect(remove(page)).toBeDisabled();
  await expect(page).toHaveURL(/\/account$/);
  expect(state.deletes).toBe(1);
  expect(state.lookups).toBe(1);
});

test("lookup retries only read and discarded permissions remove earlier links", async ({
  page,
}) => {
  const state = await setup(page);
  state.lookupStatus = 503;
  state.body = {
    error: { code: "unavailable", message: "목록을 확인할 수 없습니다.", retryable: true },
  };
  await remove(page).click();
  await expect(notice(page).getByRole("alert")).toContainText("목록을 확인할 수 없습니다.", {
    timeout: 3000,
  });
  await expect(notice(page).getByRole("link", { name: /대표 이양$/ })).toHaveCount(0);
  state.lookupStatus = 200;
  state.body = workspaces.filter((team) => team.id !== ids.first);
  await notice(page).getByRole("button", { name: "대표 팀 다시 확인" }).click();
  await expect(notice(page).getByRole("link", { name: "합성 대표 B 대표 이양" })).toBeVisible();
  await expect(notice(page).getByRole("link", { name: "합성 대표 A 대표 이양" })).toHaveCount(0);
  state.lookupStatus = 401;
  state.body = {
    error: { code: "unauthorized", message: "로그인이 필요합니다.", retryable: false },
  };
  await notice(page).getByRole("button", { name: "대표 팀 다시 확인" }).click();
  await expect(notice(page).getByRole("alert")).toContainText("로그인이 필요합니다.");
  await expect(notice(page).getByRole("link", { name: /대표 이양$/ })).toHaveCount(0);
  expect(state.lookups).toBe(3);
  expect(state.deletes).toBe(1);
  await expect(remove(page)).toBeDisabled();
});

test("an ordinary conflict does not query or show representative links", async ({ page }) => {
  const state = await setup(page);
  state.code = "conflict";
  await remove(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "대표 권한을 이양한 뒤 진행하세요.",
  );
  await expect(notice(page)).toHaveCount(0);
  expect(state.lookups).toBe(0);
  expect(state.deletes).toBe(1);
});

test("an invalid target response has no unsafe links and cannot trigger another deletion", async ({
  page,
}) => {
  const state = await setup(page);
  state.body = [{ ...workspaces[1], id: "javascript:alert(1)" }];
  await remove(page).click();
  await expect(notice(page).getByRole("alert")).toBeVisible({ timeout: 3000 });
  await expect(notice(page).getByRole("link", { name: /대표 이양$/ })).toHaveCount(0);
  await expect(notice(page).getByRole("link", { name: "팀 목록에서 확인" })).toHaveAttribute(
    "href",
    "/teams",
  );
  expect(state.deletes).toBe(1);
});

test("a pending deletion rejects duplicate submission before showing its fresh result", async ({
  page,
}) => {
  const state = await setup(page);
  let release: () => void = () => {};
  state.releaseDelete = new Promise<void>((resolve) => {
    release = resolve;
  });
  await remove(page).click();
  await expect(remove(page)).toBeDisabled();
  await remove(page).dispatchEvent("click");
  expect(state.deletes).toBe(1);
  release();
  await expect(notice(page)).toBeVisible({ timeout: 3000 });
  expect(state.deletes).toBe(1);
});

test("an empty refreshed lead list still requires explicit deletion confirmation", async ({
  page,
}) => {
  const state = await setup(page);
  state.body = [];
  await remove(page).click();
  await expect(
    notice(page).getByText("대표인 팀을 찾지 못했습니다.", { exact: false }),
  ).toBeVisible();
  await expect(notice(page).getByRole("link", { name: /대표 이양$/ })).toHaveCount(0);
  await expect(page.getByLabel("삭제할 내용을 확인했습니다.")).not.toBeChecked();
  await expect(remove(page)).toBeDisabled();
  expect(state.deletes).toBe(1);
});

test("an older response without the lead field cannot silently suggest a completed handoff", async ({
  page,
}) => {
  const state = await setup(page);
  state.body = [{ id: ids.first, name: "합성 대표 A", role: "admin", current: false }];
  await remove(page).click();
  await expect(notice(page).getByRole("alert")).toBeVisible();
  await expect(notice(page).getByRole("link", { name: /대표 이양$/ })).toHaveCount(0);
  expect(state.deletes).toBe(1);
});

test("the lead error code with a different HTTP status is not a handoff instruction", async ({
  page,
}) => {
  const state = await setup(page);
  state.deleteStatus = 503;
  await remove(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  expect(state.lookups).toBe(0);
  expect(state.deletes).toBe(1);
});
