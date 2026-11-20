import { expect, test } from "@playwright/test";
import { loadExample, signUpAndVerify, turnOnLinkSharing } from "./helpers";

test("a manual's question box keeps a chat of several questions and answers", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await page.getByRole("button", { name: "질문하기", exact: true }).click();
  const box = page.getByLabel("업무 질문", { exact: true });
  await box.fill("계정 발급 전에 무엇을 확인하나요?");
  await page.getByRole("button", { name: "근거 찾아 질문하기" }).click();
  const chat = page.getByRole("log", { name: "질문과 답변" });
  await expect(chat.getByRole("article")).toHaveCount(1);
  await expect(chat.getByText("계정 발급 전에 무엇을 확인하나요?")).toBeVisible();
  await expect(chat.getByRole("article").first().locator(".chat-answer .badge")).toBeVisible();
  await expect(box).toHaveValue("");

  await box.fill("승인자가 없으면 어떻게 하나요?");
  await box.press("Enter");
  await expect(chat.getByRole("article")).toHaveCount(2);
  await expect(chat.getByText("계정 발급 전에 무엇을 확인하나요?")).toBeVisible();
  await expect(chat.getByText("승인자가 없으면 어떻게 하나요?")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the header offers help instead of a separate question page", async ({ page }) => {
  await signUpAndVerify(page);
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(nav.getByRole("link", { name: "질문하기" })).toHaveCount(0);
  await nav.getByRole("link", { name: "도움말" }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(
    page.getByRole("heading", { name: "GhostManual 이용 방법", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "이용 순서" }).getByRole("listitem")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the floating question window opens anywhere on the manual and keeps the conversation", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  const launcher = page.getByRole("button", { name: "질문하기", exact: true });
  const dialog = page.getByRole("dialog", { name: "이 매뉴얼에 질문" });
  await expect(dialog).toBeHidden();
  await launcher.click();
  await expect(dialog).toBeVisible();
  const box = page.getByLabel("업무 질문", { exact: true });
  await expect(box).toBeFocused();
  // 좁은 화면에서는 창이 화면 전체를 덮는다.
  const viewport = page.viewportSize();
  const size = await dialog.boundingBox();
  if (viewport && viewport.width <= 560) expect(size?.width).toBe(viewport.width);
  await box.fill("계정 발급 전에 무엇을 확인하나요?");
  await box.press("Enter");
  const chat = page.getByRole("log", { name: "질문과 답변" });
  await expect(chat.getByRole("article").first().locator(".chat-answer .badge")).toBeVisible();
  // Esc로 닫으면 초점이 버튼으로 돌아가고, 다시 열면 대화가 남아 있다.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(chat.getByRole("article")).toHaveCount(1);
  // 새로고침해도 이 세션에서 한 대화가 이어진다.
  await page.reload();
  await page.getByRole("button", { name: "질문하기", exact: true }).click();
  await expect(chat.getByText("계정 발급 전에 무엇을 확인하나요?")).toBeVisible();
  await expect(chat.getByRole("article").first().locator(".chat-answer .badge")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // 새 대화를 누르면 비워지고, 새로고침해도 돌아오지 않는다.
  await page.getByRole("button", { name: "새 대화" }).click();
  await expect(chat).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "질문하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "새 대화" })).toHaveCount(0);
});

test("a reader conversation is not automatically restored in the owner's session", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(page).toHaveURL(/\/manuals\/[0-9a-f-]+$/);
  const ownerUrl = page.url();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  const sharedUrl = await turnOnLinkSharing(page);
  await page.goto(sharedUrl);
  await page.getByRole("button", { name: "질문하기", exact: true }).click();
  await page
    .getByLabel("업무 질문", { exact: true })
    .fill("후임자 세션에서만 확인할 계정 발급 질문");
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/questions" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "근거 찾아 질문하기" }).click();
  const id = (await (await saved).json()).id as string;
  await expect(
    page.getByRole("log", { name: "질문과 답변" }).locator(".chat-answer .badge"),
  ).toBeVisible();
  const manualId = new URL(ownerUrl).pathname.split("/").at(-1);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), `gm-chat:${manualId}`))
    .toContain(id);
  const restored = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/questions/${id}` && url.searchParams.get("conversation") === "1";
  });
  await page.goto(ownerUrl);
  expect((await restored).status()).toBe(404);
  await page.getByRole("button", { name: "질문하기", exact: true }).click();
  await expect(
    page.getByText("후임자 세션에서만 확인할 계정 발급 질문", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "새 대화" })).toHaveCount(0);
  // 일반 소유자 조회 계약은 그대로이며 자동 대화 복원만 현재 세션으로 제한한다.
  expect((await page.request.get(`/api/questions/${id}`)).status()).toBe(200);
});
