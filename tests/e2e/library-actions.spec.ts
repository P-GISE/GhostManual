import { expect, type Page, test } from "@playwright/test";
import { loadExample, signUpAndVerify } from "./helpers";

async function registerWorkbook(page: Page, title: string) {
  await page.getByRole("link", { name: "새 업무 등록" }).click();
  await expect(page.getByText("처음 올리는 파일만 여기서 등록하세요.")).toBeVisible();
  await page.getByLabel("자료 제목").fill(title);
  await page
    .getByLabel(/엑셀·TXT·Markdown 파일/)
    .setInputFiles("tests/fixtures/xlsx/정산_1029.xlsx");
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "문서함", exact: true }).click();
}

test("signing in returns to the landing page with a way into the library", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/");
  await page.getByRole("link", { name: "내 문서함으로" }).click();
  await expect(page.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
});

test("a workbook card opens the new version form directly", async ({ page }) => {
  await signUpAndVerify(page);
  await registerWorkbook(page, "월간 정산");
  await expect(page.getByText("이미 등록한 엑셀의 다음 파일")).toBeVisible();
  await page.getByRole("link", { name: "새 버전 올리기" }).click();
  await expect(page.getByRole("heading", { name: "월간 정산", level: 1 })).toBeVisible();
  await expect(page.getByLabel("새 버전 엑셀 파일")).toBeVisible();
});

test("several tasks are deleted together only after confirmation", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await registerWorkbook(page, "월간 정산");

  await page.getByLabel("신입 구성원 업무 계정 발급 선택").check();
  await page.getByLabel("월간 정산 선택").check();
  const remove = page.getByRole("button", { name: "선택한 2개 삭제" });
  await expect(remove).toBeDisabled();
  await page.getByLabel("선택한 업무의 영구 삭제를 확인했습니다.").check();
  await remove.click();

  await expect(page.getByText("아직 등록한 업무가 없습니다.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("아직 등록한 업무가 없습니다.")).toBeVisible();
});

test("an unchecked task stays when the selection is cancelled", async ({ page }) => {
  await signUpAndVerify(page);
  await loadExample(page);
  await page.getByLabel("신입 구성원 업무 계정 발급 선택").check();
  await page.getByRole("button", { name: "선택 취소" }).click();
  await expect(page.getByRole("button", { name: /^선택한 \d+개 삭제$/ })).toHaveCount(0);
  await expect(page.getByLabel("신입 구성원 업무 계정 발급 선택")).not.toBeChecked();
});

test("choosing a file replaces the text field with plain guidance", async ({ page }) => {
  await signUpAndVerify(page);
  await page.getByRole("link", { name: "새 업무 등록" }).click();
  await page.getByLabel("업무 내용", { exact: true }).fill("파일을 고르기 전에 쓴 글");
  await page
    .getByLabel(/엑셀·TXT·Markdown 파일/)
    .setInputFiles("tests/fixtures/xlsx/정산_1029.xlsx");
  await expect(page.getByLabel("업무 내용", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/엑셀은 등록한 뒤 원본 화면의 질문에 답하며/)).toBeVisible();
  await expect(page.getByText(/입력한 업무 내용은 저장되지 않습니다/)).toBeVisible();
});

test("changes come before questions and the sheet preview starts folded", async ({ page }) => {
  await signUpAndVerify(page);
  await registerWorkbook(page, "월간 정산");
  await page.getByRole("link", { name: "새 버전 올리기" }).click();
  await page.getByLabel("새 버전 엑셀 파일").setInputFiles("tests/fixtures/xlsx/정산_1030.xlsx");
  await page.getByRole("button", { name: "올리고 비교하기" }).click();
  const changes = page.getByRole("heading", { name: /v1과 비교해 바뀐 부분/ });
  const questions = page.getByRole("heading", { name: "이번 버전 질문" });
  await expect(changes).toBeVisible();
  const [changesBox, questionsBox] = [await changes.boundingBox(), await questions.boundingBox()];
  expect(changesBox && questionsBox && changesBox.y < questionsBox.y).toBe(true);
  await expect(page.getByRole("heading", { name: "시트 미리보기" })).toBeVisible();
  const preview = page.getByRole("region", { name: "시트 미리보기" });
  await expect(preview.getByRole("table")).toBeHidden();
  await preview.getByText(/펼쳐서 보기 · 시트/).click();
  await expect(preview.getByRole("table")).toBeVisible();
});

test("a wrongly chosen file can be removed before registering", async ({ page }) => {
  await signUpAndVerify(page);
  await page.getByRole("link", { name: "새 업무 등록" }).click();
  const picker = page.getByLabel(/엑셀·TXT·Markdown 파일/);
  await expect(page.getByRole("button", { name: "선택한 파일 지우기" })).toHaveCount(0);
  await picker.setInputFiles("tests/fixtures/xlsx/정산_1029.xlsx");
  await expect(page.getByLabel("업무 내용", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "선택한 파일 지우기" }).click();
  await expect(picker).toHaveValue("");
  await expect(page.getByRole("button", { name: "선택한 파일 지우기" })).toHaveCount(0);
  await expect(page.getByLabel("업무 내용", { exact: true })).toBeVisible();
  await picker.setInputFiles("tests/fixtures/xlsx/정산_1030.xlsx");
  await page.getByLabel("자료 제목").fill("다시 고른 정산");
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("heading", { name: "다시 고른 정산", level: 1 })).toBeVisible();
});
