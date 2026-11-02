import { expect, test } from "@playwright/test";
import { loadExample, signUpAndVerify } from "./helpers";

test("a manual's question box keeps a chat of several questions and answers", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
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
