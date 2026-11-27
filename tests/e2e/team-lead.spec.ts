import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

test("the lead appoints a deputy and hands the lead over; only the lead sees lead controls", async ({
  page,
  browser,
}) => {
  await signUpAndVerify(page, undefined, "대표 담당자", false);
  const origin = new URL(page.url()).origin;
  const created = await page.request.post("/api/workspaces", {
    headers: { Origin: origin },
    data: { name: "역할 검증 팀" },
  });
  expect(created.status()).toBe(201);
  const teamId = (await created.json()).id as string;

  const context = await browser.newContext({ viewport: page.viewportSize() });
  const other = await context.newPage();
  await signUpAndVerify(other, undefined, "신입", false);
  const invitee = await (await other.request.get("/api/me")).json();
  const invited = await page.request.post(`/api/workspaces/${teamId}/invites`, {
    headers: { Origin: origin },
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
  await expect(other).toHaveURL(new RegExp(`/teams/${teamId}$`));

  // 관리자의 팀원 목록: 내 줄에는 역할 버튼이 없고, 팀원 줄에 지정·넘기기·내보내기가 있다.
  await page.goto(`/teams/${teamId}?tab=members`);
  const mine = page.getByRole("listitem").filter({ hasText: "대표 담당자" });
  const theirs = page.getByRole("listitem").filter({ hasText: "신입" });
  await expect(mine.getByText("관리자", { exact: true })).toBeVisible();
  await expect(theirs.getByText("팀원", { exact: true })).toBeVisible();
  await expect(mine.getByRole("button")).toHaveCount(0);
  await theirs.getByRole("button", { name: "신입 부관리자로 지정" }).click();
  await expect(theirs.getByText("부관리자", { exact: true })).toBeVisible();

  // 부관리자: 초대는 하지만 역할 변경·넘기기·팀 삭제는 보이지 않고, 다른 관리 권한자를 내보낼 수 없다.
  await other.goto(`/teams/${teamId}?tab=members`);
  await expect(other.getByLabel("초대할 사람의 이메일")).toBeVisible();
  await expect(
    other.getByRole("listitem").filter({ hasText: "대표 담당자" }).getByText("관리자", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: /관리자 넘기기|지정|팀원으로 변경|내보내기/ }),
  ).toHaveCount(0);
  await other.getByRole("tab", { name: "팀 설정" }).click();
  await expect(other.getByRole("button", { name: "팀 나가기" })).toBeEnabled();
  await expect(other.getByRole("heading", { name: "팀 문서함 삭제" })).toHaveCount(0);

  // 넘기기는 한 번 더 확인받는다. 취소하면 그대로다.
  await theirs.getByRole("button", { name: "신입에게 관리자 넘기기" }).click();
  await expect(
    theirs.getByText("신입 님에게 관리자를 넘깁니다. 나는 부관리자가 됩니다.", { exact: true }),
  ).toBeVisible();
  await theirs.getByRole("button", { name: "취소" }).click();
  await expect(mine.getByText("관리자", { exact: true })).toBeVisible();
  await theirs.getByRole("button", { name: "신입에게 관리자 넘기기" }).click();
  await theirs.getByRole("button", { name: "넘기기 확인" }).click();
  await expect(page.getByText("신입 님에게 관리자를 넘겼습니다.", { exact: true })).toBeVisible();
  await expect(theirs.getByText("관리자", { exact: true })).toBeVisible();
  await expect(mine.getByText("부관리자", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /관리자 넘기기|지정|팀원으로 변경/ })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("tab", { name: "팀 설정" }).click();
  await expect(page.getByRole("button", { name: "팀 나가기" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "팀 문서함 삭제" })).toHaveCount(0);

  // 새 관리자는 넘기기 전에는 나갈 수 없고, 팀 삭제가 보인다.
  await other.reload();
  await expect(other.getByRole("button", { name: "팀 나가기" })).toBeDisabled();
  await expect(other.getByRole("heading", { name: "팀 문서함 삭제" })).toBeVisible();
  await context.close();
});
