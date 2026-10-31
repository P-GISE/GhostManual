import { expect, test } from "@playwright/test";
import { openAsNewReader, signUpAndVerify, turnOnLinkSharing } from "./helpers";

const fixture = (name: string) => `tests/fixtures/xlsx/${name}`;

test("an owner uploads two workbook versions, answers questions and sees the changes", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("월간 정산");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("heading", { name: "월간 정산", level: 1 })).toBeVisible();
  await expect(page.getByText("이 파일은 어떤 업무를 위한 것인가요?")).toBeVisible();

  const first = page.getByRole("group", { name: "이 파일은 어떤 업무를 위한 것인가요?" });
  await first.getByLabel("답변").fill("매달 거래처 정산 금액을 맞추는 파일입니다.");
  await first.getByRole("button", { name: "답변 저장" }).click();
  await expect(first.getByText("매달 거래처 정산 금액을 맞추는 파일입니다.")).toBeVisible();

  await page.getByRole("button", { name: "새 버전 올리기" }).click();
  await page.getByLabel("새 버전 엑셀 파일").setInputFiles(fixture("정산_1030.xlsx"));
  await page.getByRole("button", { name: "올리고 비교하기" }).click();
  await expect(page.getByRole("status")).toContainText("v2를 저장했습니다");
  await expect(page.getByRole("heading", { name: "v1과 비교해 바뀐 부분 3건" })).toBeVisible();
  await expect(page.getByText(/'원본' F2:F40의 수식을/)).toBeVisible();

  const skipped = page.getByRole("group").filter({ hasText: "바뀐 값" }).first();
  await skipped.getByRole("button", { name: "건너뛰기" }).click();
  await expect(skipped.getByText("건너뜀")).toBeVisible();

  await expect(page.getByRole("link", { name: "v2 원본 내려받기" })).toHaveAttribute(
    "href",
    /\/api\/sources\/[\w-]+\/revisions\/2\/file$/,
  );
  await page.getByRole("button", { name: /^v1/ }).click();
  await expect(page.getByText("매달 거래처 정산 금액을 맞추는 파일입니다.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a dangerous workbook is refused with a clear message", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("위험한 파일");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("macro.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("매크로·암호가 없는 .xlsx");
});

test("demo: publish a manual from workbook versions and a successor sees the change history", async ({
  page,
  browser,
}) => {
  await signUpAndVerify(page, undefined, "박효민");
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("월간 정산");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("heading", { name: "월간 정산", level: 1 })).toBeVisible();
  const sourceUrl = page.url();
  const purpose = page.getByRole("group", { name: "이 파일은 어떤 업무를 위한 것인가요?" });
  await purpose.getByLabel("답변").fill("매달 거래처 정산 금액을 맞추는 파일입니다.");
  await purpose.getByRole("button", { name: "답변 저장" }).click();
  await expect(purpose.getByText("매달 거래처 정산 금액을 맞추는 파일입니다.")).toBeVisible();

  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page).toHaveURL(/\/manuals\/[\w-]+\/edit$/);
  const manualUrl = page.url().replace(/\/edit$/, "");
  await page.getByLabel("업무 목적", { exact: true }).fill("매달 거래처 정산 금액을 맞춥니다.");
  await page
    .getByLabel("업무 순서", { exact: true })
    .fill("ERP에서 내려받아 원본 시트에 붙입니다.");
  await page.getByLabel("완료 기준", { exact: true }).fill("합계가 ERP와 같습니다.");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.")).toBeVisible();

  await page.goto(sourceUrl);
  await page.getByRole("button", { name: "새 버전 올리기" }).click();
  await page.getByLabel("새 버전 엑셀 파일").setInputFiles(fixture("정산_1030.xlsx"));
  await page.getByRole("button", { name: "올리고 비교하기" }).click();
  await expect(page.getByRole("status")).toContainText("v2를 저장했습니다");
  const formula = page.getByRole("group").filter({ hasText: "수식을" }).first();
  await formula.getByLabel("답변").fill("반품(음수)을 합계에서 빼야 해서 바꿨습니다.");
  await formula.getByRole("button", { name: "답변 저장" }).click();
  await expect(formula.getByText("반품(음수)을 합계에서 빼야 해서 바꿨습니다.")).toBeVisible();

  await page.goto(manualUrl);
  await expect(page.getByText("재검토 필요", { exact: true })).toBeVisible();
  await expect(page.getByText(/\[v2 확인 필요\]/).first()).toBeVisible();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  const url = await turnOnLinkSharing(page);

  const { context, page: reader } = await openAsNewReader(browser, url, page.viewportSize());
  try {
    await expect(reader.getByRole("heading", { name: "파일 변경 이력" })).toBeVisible();
    await expect(reader.getByText(/v2 · .* · 박효민/)).toBeVisible();
    await expect(reader.getByText("A. 반품(음수)을 합계에서 빼야 해서 바꿨습니다.")).toBeVisible();
    await expect(reader.getByRole("link", { name: "정산_1030.xlsx 내려받기" })).toHaveAttribute(
      "href",
      /\/revisions\/2\/file\?view=shared$/,
    );
    await expect(reader.getByRole("link", { name: "정산_1029.xlsx 내려받기" })).toHaveCount(0);
    const download = await reader.request.get(
      (await reader.getByRole("link", { name: "정산_1030.xlsx 내려받기" }).getAttribute("href")) ??
        "",
    );
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
  } finally {
    await context.close();
  }
});
