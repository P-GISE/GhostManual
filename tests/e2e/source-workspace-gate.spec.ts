import { expect, test } from "@playwright/test";
import { hubPersonalId, hubTeamId } from "../fixtures/hub-overview";

test("new work waits for a known team and preserves team-only guidance for a personal session", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { name: "합성 담당자", admin: false } }),
  );
  await page.route("**/api/workspaces", async (route) => {
    await gate;
    await route.fulfill({ json: [{ id: hubPersonalId, name: null, role: null, current: true }] });
  });
  try {
    await page.goto("/sources/new");
    await expect(page.getByRole("heading", { name: "새 업무 등록", exact: true })).toBeVisible();
    await expect(page.getByLabel("자료 제목", { exact: true })).toHaveCount(0);
    await expect(page.getByText("문서함을 확인하고 있습니다.", { exact: true })).toBeVisible();
    release();
    await expect(page.getByText("새 업무는 팀 문서함에 올립니다.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("자료 제목", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("unknown workspace cannot expose the new-work form but a known team can", async ({ page }) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { name: "합성 담당자", admin: false } }),
  );
  let failed = true;
  await page.route("**/api/workspaces", (route) =>
    route.fulfill(
      failed
        ? {
            status: 403,
            json: { error: { code: "forbidden", message: "합성 확인 실패", retryable: false } },
          }
        : { json: [{ id: hubTeamId, name: "합성 업무 팀", role: "member", current: true }] },
    ),
  );
  await page.goto("/sources/new");
  await expect(
    page.getByRole("alert").filter({ hasText: "문서함을 확인하지 못했습니다." }),
  ).toBeVisible();
  await expect(page.getByLabel("자료 제목", { exact: true })).toHaveCount(0);
  failed = false;
  await page.reload();
  await expect(page.getByLabel("자료 제목", { exact: true })).toBeVisible();
});
