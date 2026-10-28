import { expect, test } from "@playwright/test";
import { loadExample, openAsNewReader, signUpAndVerify, turnOnLinkSharing } from "./helpers";

test("prewritten example can be reviewed shared and searched without pretending live AI", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signUpAndVerify(page);
  await loadExample(page);
  await expect(page.getByRole("heading", { name: "업무 문서함" })).toBeVisible();
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(page.getByText("미리 작성된 합성 예제", { exact: true })).toBeVisible();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  const url = await turnOnLinkSharing(page);
  expect(url).toContain("/share#");
  const { context: reader, page: readerPage } = await openAsNewReader(
    browser,
    url,
    page.viewportSize(),
  );
  await expect(
    readerPage.getByRole("heading", { name: "신입 구성원 업무 계정 발급" }),
  ).toBeVisible();
  await expect(readerPage.getByRole("button", { name: "검수 완료·버전 게시" })).toHaveCount(0);
  await expect(readerPage).toHaveURL(/share$/);
  await readerPage
    .getByLabel("업무 질문", { exact: true })
    .fill("계정 발급 전에 무엇을 확인하나요?");
  await readerPage.getByRole("button", { name: "근거 찾아 질문하기" }).click();
  await expect(readerPage.getByText("AI 답변 이용 불가", { exact: true })).toBeVisible();
  await expect(readerPage.getByRole("heading", { name: "검색 결과", exact: true })).toBeVisible();
  const evidence = readerPage.locator("details").last();
  await evidence.locator("summary").click();
  await expect(evidence).toContainText("신입");
  await page.getByLabel("비공개", { exact: true }).check();
  await readerPage.reload();
  await expect(readerPage.getByRole("main").getByRole("alert")).toBeVisible();
  expect(errors).toEqual([]);
  await reader.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test("source input remains available when AI is disabled", async ({ page }) => {
  await signUpAndVerify(page);
  await page.getByRole("link", { name: "새 자료 등록" }).click();
  await page.getByLabel("자료 제목").fill("HTML 원문 안전 표시");
  const text =
    "<script>window.injected=true</script>" + "승인을 확인하고 업무를 완료합니다. ".repeat(10);
  await page.getByLabel("업무 내용", { exact: true }).fill(text);
  await page.getByRole("button", { name: "원본 등록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "HTML 원문 안전 표시" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "injected"))).toBeUndefined();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("owner can revise a source then re-review the same manual", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(
    page.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
  ).toBeVisible();
  const manualUrl = page.url();
  await page.getByRole("link", { name: "초안 수정", exact: true }).click();
  await page
    .getByLabel("업무 목적", { exact: true })
    .fill("후임자가 계정 발급을 완료하도록 안내합니다.");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  await page.locator("details").first().locator("summary").click();
  await page.getByRole("link", { name: "원본 위치 보기", exact: true }).first().click();
  await page.getByRole("button", { name: "원본 수정", exact: true }).click();
  const input = page.getByLabel("원본 내용", { exact: true });
  await input.fill((await input.inputValue()) + " 새 절차: 발급 후 담당자가 기록합니다.");
  await page.getByRole("button", { name: "새 원본 버전 저장", exact: true }).click();
  await expect(page.getByText("원본 자료 · 버전 2", { exact: true })).toBeVisible();
  await page.goto(manualUrl);
  await expect(page.getByText("재검토 필요", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "초안 수정", exact: true }).click();
  await page
    .getByLabel("업무 목적", { exact: true })
    .fill("변경된 원본에 따라 발급과 기록을 확인합니다.");
  await page.getByLabel("변경된 원본과 초안의 모든 항목을 다시 확인했습니다.").check();
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 2", { exact: true })).toBeVisible();
  await expect(page.getByText("재검토 필요", { exact: true })).toHaveCount(0);
});
