import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

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
