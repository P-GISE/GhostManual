import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

test("admins see the progress tab with each task's step; members do not", async ({
  page,
  browser,
}) => {
  await signUpAndVerify(page, undefined, "진행 담당자");
  await page.goto("/teams");
  await page.getByLabel("팀 이름").fill("진행 검증 팀");
  await page.getByRole("button", { name: "팀 문서함 만들기" }).click();
  await page.getByRole("link", { name: "새 업무 등록" }).click();
  await page.getByLabel("자료 제목").fill("진행을 볼 업무");
  await page
    .getByLabel("업무 내용", { exact: true })
    .fill("승인을 확인한 뒤 계정을 발급하고 결과를 기록합니다. ".repeat(10));
  await page.getByRole("button", { name: "원본 등록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "진행을 볼 업무" })).toBeVisible();
  const teamId = (await (await page.request.get("/api/workspaces")).json()).find(
    (workspace: { current: boolean }) => workspace.current,
  ).id as string;

  await page.goto(`/teams/${teamId}`);
  await page.getByRole("tab", { name: "진행 현황" }).click();
  await expect(page).toHaveURL(/\?tab=progress$/);
  const row = page.getByRole("row").filter({ hasText: "진행을 볼 업무" });
  await expect(row.getByText("진행 담당자", { exact: true })).toBeVisible();
  // 원본은 끝났고 매뉴얼이 없으니 초안이 진행 중이다.
  await expect(row.getByRole("listitem").filter({ hasText: "원본" })).toContainText("끝남");
  await expect(row.getByRole("listitem").filter({ hasText: "질문" })).toContainText("끝남");
  await expect(row.getByRole("listitem").filter({ hasText: "초안" })).toContainText("진행 중");
  await expect(row.getByRole("listitem").filter({ hasText: "게시" })).toContainText("전");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 팀원에게는 탭이 없고, 주소로 열어도 업무 탭이 나온다.
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const other = await context.newPage();
  await signUpAndVerify(other, undefined, "신입");
  const invitee = await (await other.request.get("/api/me")).json();
  const invited = await page.request.post(`/api/workspaces/${teamId}/invites`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { email: invitee.email },
  });
  expect(invited.status()).toBe(201);
  const { E2E_MAIL_DIR: dir = "" } = process.env;
  const file = readdirSync(dir)
    .filter((name) => name.endsWith(`-${invitee.email}.txt`))
    .sort()
    .at(-1);
  const link = file
    ? readFileSync(join(dir, file), "utf8").match(/https?:\/\/\S+\/invite#\S+/)?.[0]
    : undefined;
  if (!link) throw new Error("Missing synthetic invite");
  await other.goto(link);
  await expect(other).toHaveURL(/\/manuals$/);
  await other.goto(`/teams/${teamId}?tab=progress`);
  await expect(other.getByRole("tab", { name: "업무" })).toHaveAttribute("aria-selected", "true");
  await expect(other.getByRole("tab", { name: "진행 현황" })).toHaveCount(0);
  expect((await other.request.get(`/api/workspaces/${teamId}/progress`)).status()).toBe(403);
  await context.close();
});
