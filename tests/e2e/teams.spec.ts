import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signUpAndVerify, uniqueEmail } from "./helpers";

// 초대 메일에서 수락 링크를 꺼낸다(테스트 서버는 메일을 파일로 남긴다).
async function inviteLink(email: string): Promise<string> {
  const dir = process.env["E2E_MAIL_DIR"] ?? "";
  let link: string | undefined;
  await expect
    .poll(() => {
      const name = readdirSync(dir)
        .filter((file) => file.endsWith(`-${email}.txt`))
        .sort()
        .at(-1);
      link = name
        ? readFileSync(join(dir, name), "utf8").match(/https?:\/\/\S+\/invite#\S+/)?.[0]
        : undefined;
      return Boolean(link);
    })
    .toBe(true);
  return link ?? "";
}

test("a team admin invites a member, both work in the team library, and a removed member returns home", async ({
  page,
  browser,
}) => {
  await signUpAndVerify(page, undefined, "팀장");
  await page.getByRole("link", { name: "팀", exact: true }).click();
  await expect(page.getByText("속한 팀 문서함이 없습니다.", { exact: true })).toBeVisible();
  await page.getByLabel("팀 이름").fill("정산팀");
  await page.getByRole("button", { name: "팀 문서함 만들기" }).click();
  await expect(page.getByRole("heading", { name: "정산팀", level: 1 })).toBeVisible();
  // 만든 직후에는 안내와 초대가 먼저 나온다.
  await expect(page.getByText("정산팀 문서함을 만들었습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "새 업무 등록" })).toBeVisible();

  // 초대받을 사람이 먼저 가입해 둔다. 초대는 그 이메일 주소에 묶인다.
  const memberEmail = uniqueEmail();
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const memberPage = await context.newPage();
  await signUpAndVerify(memberPage, memberEmail, "신입");
  await page.getByLabel("초대할 사람의 이메일").fill(memberEmail);
  await page.getByRole("button", { name: "초대 메일 보내기" }).click();
  await expect(page.getByText("초대 메일을 보냈습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `${memberEmail} 초대 취소` })).toBeVisible();

  // 신입이 링크를 열면 팀 문서함으로 들어간다.
  await memberPage.goto(await inviteLink(memberEmail));
  await expect(memberPage).toHaveURL(/\/manuals$/);
  await expect(memberPage.getByLabel("문서함 전환")).toHaveValue(/[0-9a-f-]{36}/);
  await expect(memberPage.getByLabel("문서함 전환").locator("option:checked")).toHaveText("정산팀");
  const teamId = await memberPage.getByLabel("문서함 전환").inputValue();
  await memberPage.goto(`/teams/${teamId}?created=1`);
  await expect(memberPage.getByRole("heading", { name: "정산팀", level: 1 })).toBeVisible();
  await expect(memberPage.getByLabel("초대할 사람의 이메일")).toHaveCount(0);
  await expect(memberPage.getByText("정산팀 문서함을 만들었습니다.", { exact: true })).toHaveCount(
    0,
  );
  await expect(memberPage.getByRole("tab", { name: "업무", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    memberPage.getByRole("tabpanel").getByRole("heading", { name: "업무", exact: true }),
  ).toBeVisible();
  await memberPage.goto("/sources/new");
  await memberPage.getByLabel("자료 제목").fill("신입이 올린 업무");
  await memberPage
    .getByLabel("업무 내용", { exact: true })
    .fill("승인을 확인하고 업무 계정을 발급합니다. ".repeat(10));
  await memberPage.getByRole("button", { name: "원본 등록", exact: true }).click();
  await expect(memberPage.getByRole("heading", { name: "신입이 올린 업무" })).toBeVisible();

  // 팀장은 내 문서함에서는 그 업무가 안 보이고, 팀 문서함으로 전환하면 보인다.
  await page.goto("/manuals");
  await page.getByLabel("문서함 전환").selectOption({ label: "내 문서함" });
  await expect(page.getByLabel("문서함 전환").locator("option:checked")).toHaveText("내 문서함");
  await expect(page.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
  await expect(page.getByText("신입이 올린 업무")).toHaveCount(0);
  await page.getByLabel("문서함 전환").selectOption({ label: "정산팀" });
  await expect(page.getByLabel("문서함 전환").locator("option:checked")).toHaveText("정산팀");
  await expect(page.getByText("신입이 올린 업무").first()).toBeVisible();
  await expect(page.getByText("올린 사람 신입", { exact: true })).toBeVisible();
  // 문서함 머리글도 팀 이름으로 바뀐다.
  await expect(page.locator(".eyebrow").filter({ hasText: "정산팀" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 내보내면 신입은 다음 요청에서 내 문서함으로 돌아가고, 올린 업무는 팀에 남는다.
  await page.getByRole("link", { name: "팀", exact: true }).click();
  await page.getByRole("link", { name: "정산팀" }).click();
  // 팀 화면은 업무 탭으로 열리고, 초대와 팀원은 "팀원·초대" 탭에 있다.
  await expect(page.getByRole("tab", { name: "업무" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").getByText("신입이 올린 업무").first()).toBeVisible();
  await page.getByRole("tab", { name: "팀원·초대" }).click();
  await expect(page).toHaveURL(/\?tab=members$/);
  await expect(page.getByLabel("초대할 사람의 이메일")).toBeVisible();
  await expect(page.getByRole("heading", { name: "팀원 2명" })).toBeVisible();
  await page.getByRole("button", { name: "신입 내보내기" }).click();
  await expect(page.getByRole("heading", { name: "팀원 1명" })).toBeVisible();
  await page.getByRole("tab", { name: "팀 설정" }).click();
  await expect(page.getByRole("button", { name: "팀 나가기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이 팀 문서함 삭제" })).toBeDisabled();
  await memberPage.goto("/manuals");
  await expect(memberPage.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
  await expect(memberPage.getByText("신입이 올린 업무")).toHaveCount(0);
  await expect(memberPage.getByLabel("문서함 전환")).toHaveCount(0);
  await page.goto("/manuals");
  await expect(page.getByText("신입이 올린 업무").first()).toBeVisible();
  await context.close();
});

for (const loseResponse of [false, true]) {
  test(`moves a personal source with response loss=${loseResponse}`, async ({ page }) => {
    await signUpAndVerify(page, undefined, "이동 담당자");
    await page.goto("/teams");
    await page.getByLabel("팀 이름").fill("업무 이동 팀");
    await page.getByRole("button", { name: "팀 문서함 만들기" }).click();
    await expect(page.getByRole("heading", { name: "업무 이동 팀", level: 1 })).toBeVisible();
    // 팀을 만들면 그 팀으로 전환된다. 개인 업무를 만들려고 내 문서함으로 돌아간다.
    await page.getByLabel("문서함 전환").selectOption({ label: "내 문서함" });
    await expect(page.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
    await page.goto("/sources/new");
    await page.getByLabel("자료 제목").fill("옮길 합성 업무");
    await page
      .getByLabel("업무 내용", { exact: true })
      .fill("승인을 확인한 뒤 계정을 발급하고 결과를 기록합니다. ".repeat(10));
    await page.getByRole("button", { name: "원본 등록", exact: true }).click();
    await expect(page.getByRole("heading", { name: "옮길 합성 업무" })).toBeVisible();
    const sourceUrl = page.url();
    const move = page.getByRole("region", { name: "팀 문서함으로 업무 이동" });
    await expect(move).toBeVisible();
    const submit = move.getByRole("button", { name: "이 업무를 팀으로 옮기기" });
    await expect(submit).toBeDisabled();
    await move.getByLabel("옮길 팀 문서함").selectOption({ label: "업무 이동 팀" });
    await expect(submit).toBeDisabled();
    await move.getByRole("checkbox").check();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let intercepted = false;
    await page.route("**/api/sources/*/move", async (route) => {
      intercepted = true;
      await ready;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (loseResponse) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await submit.click();
    try {
      await expect.poll(() => intercepted).toBe(true);
      await expect(page.getByRole("button", { name: "원본 수정", exact: true })).toBeDisabled();
    } finally {
      release();
    }
    if (loseResponse) {
      await expect(submit).toBeDisabled();
      await page.getByRole("button", { name: "선택한 팀에서 업무 확인" }).click();
    } else {
      await expect(page.getByRole("heading", { name: "팀 문서함으로 옮겼습니다" })).toBeVisible();
      await page.getByRole("button", { name: "팀 문서함에서 열기" }).click();
    }
    await expect(page).toHaveURL(sourceUrl);
    await expect(page.getByRole("heading", { name: "옮길 합성 업무" })).toBeVisible();
    await expect(page.getByLabel("문서함 전환").locator("option:checked")).toHaveText(
      "업무 이동 팀",
    );
    await expect(page.getByRole("region", { name: "팀 문서함으로 업무 이동" })).toHaveCount(0);
    await page.getByLabel("문서함 전환").selectOption({ label: "내 문서함" });
    await expect(page.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
    await expect(page.getByText("옮길 합성 업무")).toHaveCount(0);
  });
}

test("workspace switch failure is shown and leaves the current workspace selected", async ({
  page,
}) => {
  await signUpAndVerify(page);
  const personal = crypto.randomUUID();
  const team = crypto.randomUUID();
  await page.route("**/api/workspaces", (route) =>
    route.fulfill({
      json: [
        { id: personal, name: null, role: null, current: true },
        { id: team, name: "접근이 회수된 팀", role: "member", current: false },
      ],
    }),
  );
  await page.route("**/api/session/workspace", (route) =>
    route.fulfill({
      status: 403,
      json: { error: { message: "팀 접근 권한이 없습니다." } },
    }),
  );
  await page.goto("/manuals");
  await page.getByLabel("문서함 전환").selectOption(team);
  await expect(page.getByText("팀 접근 권한이 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("문서함 전환")).toBeEnabled();
  await expect(page.getByLabel("문서함 전환")).toHaveValue(personal);
});

test("direct team entry rotates the personal session and selects exactly that team", async ({
  page,
  request,
}) => {
  await signUpAndVerify(page);
  const response = await page.request.post("/api/workspaces", {
    headers: { Origin: new URL(page.url()).origin },
    data: { name: "직접 방문 팀" },
  });
  expect(response.status()).toBe(201);
  const team: { id: string } = await response.json();
  const initialWorkspaces: { id: string; current: boolean }[] = await (
    await page.request.get("/api/workspaces")
  ).json();
  const personal = initialWorkspaces.find((workspace) => workspace.current);
  if (!personal) throw new Error("Missing personal workspace");
  const oldCookie = (await page.context().cookies()).find((cookie) => cookie.name === "gm_owner");
  if (!oldCookie) throw new Error("Missing personal session");
  const oldSession = () =>
    request.get("/api/session", { headers: { Cookie: `gm_owner=${oldCookie.value}` } });
  expect((await oldSession()).status()).toBe(200);

  await page.goto(`/teams/${team.id}`);
  await expect(page.getByRole("heading", { name: "직접 방문 팀", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("tabpanel").getByRole("heading", { name: "업무", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("문서함 전환")).toHaveValue(team.id);
  await expect(page.getByLabel("문서함 전환")).not.toHaveValue(personal.id);
  const currentCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "gm_owner",
  );
  expect(Boolean(currentCookie && currentCookie.value !== oldCookie.value)).toBe(true);
  expect((await oldSession()).status()).toBe(401);
  const workspaces: { id: string; current: boolean }[] = await (
    await page.request.get("/api/workspaces")
  ).json();
  expect(
    workspaces.filter((workspace) => workspace.current).map((workspace) => workspace.id),
  ).toEqual([team.id]);
});

test("direct team entry denied by the switch API never renders the personal works or forms", async ({
  page,
}) => {
  await signUpAndVerify(page);
  const response = await page.request.post("/api/workspaces", {
    headers: { Origin: new URL(page.url()).origin },
    data: { name: "전환 거부 팀" },
  });
  expect(response.status()).toBe(201);
  const team: { id: string } = await response.json();
  const workspaces: { id: string; current: boolean }[] = await (
    await page.request.get("/api/workspaces")
  ).json();
  const personal = workspaces.find((workspace) => workspace.current);
  if (!personal) throw new Error("Missing personal workspace");
  const listRequests: string[] = [];
  await page.route(/\/api\/(sources|manuals|templates)(\?|$)/, async (route) => {
    listRequests.push(new URL(route.request().url()).pathname);
    await route.continue();
  });
  await page.route("**/api/session/workspace", (route) =>
    route.fulfill({
      status: 403,
      json: { error: { message: "팀 접근 권한이 없습니다." } },
    }),
  );
  await page.goto(`/teams/${team.id}?tab=forms`);
  await expect(page.getByRole("alert")).toHaveText("팀 접근 권한이 없습니다.");
  await expect(page.getByLabel("문서함 전환")).toHaveValue(personal.id);
  await expect(page.getByRole("tab", { name: "양식", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel").getByRole("heading")).toHaveCount(0);
  await expect(page.getByLabel("양식 파일")).toHaveCount(0);
  await page.getByRole("tab", { name: "업무", exact: true }).click();
  await expect(page.getByRole("tab", { name: "업무", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel").getByRole("heading")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "새 업무 등록" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText("팀 접근 권한이 없습니다.");
  expect(listRequests).toEqual([]);
});
