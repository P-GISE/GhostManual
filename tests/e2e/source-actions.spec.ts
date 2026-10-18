import { expect, test } from "@playwright/test";

test("direct writing opens an existing draft after source changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "합성 예제 열기" }).click();
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(
    page.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
  ).toBeVisible();
  const manualUrl = page.url();
  await page.locator("details").first().locator("summary").click();
  await page.getByRole("link", { name: "원본 위치 보기", exact: true }).first().click();
  await page.getByRole("button", { name: "원본 수정", exact: true }).click();
  const input = page.getByLabel("원본 내용", { exact: true });
  await input.fill((await input.inputValue()) + " 변경된 원본도 담당자가 확인합니다.");
  await page.getByRole("button", { name: "새 원본 버전 저장", exact: true }).click();
  await expect(page.getByText("원본 자료 · 버전 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page).toHaveURL(`${manualUrl}/edit`);
  await expect(page.getByLabel("업무 목적", { exact: true })).not.toHaveValue("");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("confirmed source deletion preserves another source", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "합성 예제 열기" }).click();
  await page.getByRole("link", { name: "새 자료 등록", exact: true }).click();
  await page.getByLabel("자료 제목").fill("삭제할 자료");
  await page
    .getByLabel("업무 내용", { exact: true })
    .fill("삭제용 합성 자료입니다. 원본 내용을 확인하고 업무를 완료합니다. ".repeat(5));
  await page.getByRole("button", { name: "원본 등록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "삭제할 자료", level: 1 })).toBeVisible();
  const sourceUrl = page.url();
  const remove = page.getByRole("button", { name: "이 원본 삭제", exact: true });
  await expect(remove).toBeDisabled();
  await page.getByLabel("원본과 연결된 매뉴얼·공유·질문 기록의 영구 삭제를 확인했습니다.").check();
  await remove.click();
  await expect(page.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "삭제할 자료", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first(),
  ).toBeVisible();
  await page.goto(sourceUrl);
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "원본 수정", exact: true })).toHaveCount(0);
});

test("shared reader can inspect linked source without owner actions", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "합성 예제 열기" }).click();
  await page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first().click();
  await expect(
    page.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "공유 링크 만들기" }).click();
  const shareUrl = await page.getByLabel("읽기 전용 링크").inputValue();
  const reader = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const readerPage = await reader.newPage();
    await readerPage.goto(shareUrl);
    await expect(
      readerPage.getByRole("heading", { name: "신입 구성원 업무 계정 발급", level: 1 }),
    ).toBeVisible();
    await readerPage.locator("details").first().locator("summary").click();
    await readerPage.getByRole("link", { name: "원본 위치 보기", exact: true }).first().click();
    await expect(
      readerPage.getByText("공유 매뉴얼에 연결된 원본입니다. 읽기 전용으로 확인할 수 있습니다."),
    ).toBeVisible();
    await expect(readerPage.getByRole("button", { name: "원본 수정", exact: true })).toHaveCount(0);
    await expect(
      readerPage.getByRole("button", { name: "직접 작성하기", exact: true }),
    ).toHaveCount(0);
    await expect(readerPage.getByRole("button", { name: "이 원본 삭제", exact: true })).toHaveCount(
      0,
    );
    await expect(readerPage.getByRole("main").getByRole("alert")).toHaveCount(0);
  } finally {
    await reader.close();
  }
});
