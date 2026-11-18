import { expect, type Page, test } from "@playwright/test";
import { pool } from "../../src/lib/db.ts";
import { runTemplateJob } from "../../src/lib/template-extraction.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { signUpAndVerify } from "./helpers";

test.afterAll(() => pool.end());

async function register(page: Page, name: string, buffer: Buffer) {
  await page.goto("/templates");
  await expect(page.getByText("등록한 양식이 없습니다.", { exact: true })).toBeVisible();
  await page.getByLabel("양식 파일").setInputFiles({
    name,
    mimeType: "application/octet-stream",
    buffer,
  });
  await page.getByRole("button", { name: "양식 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
}

// 화면의 상태 재조회가 문서함 행을 잡은 순간에는 워커가 작업을 건너뛰므로 보일 때까지 다시 돌린다.
async function extracted(page: Page, heading: string) {
  await expect(async () => {
    while (await runTemplateJob());
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 3000 });
  }).toPass();
}

test("owner registers a template, sees candidates with the warning, then deletes it", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await register(page, "인계서.docx", Buffer.from(pack(docx(wp("업무 목적") + wp("완료 기준")))));
  await expect(
    page.getByText("양식에서 항목 후보를 꺼내고 있습니다.", { exact: false }),
  ).toBeVisible();
  await extracted(page, "꺼낸 후보 2개");
  await expect(
    page.getByText("작성된 값이 후보에 포함될 수 있습니다.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "완료 기준" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "양식 목록" }).click();
  await expect(page.getByRole("link", { name: "인계서.docx" })).toBeVisible();
  await expect(page.getByText("항목 확인 필요", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "인계서.docx" }).click();
  await page.getByLabel("이 양식의 영구 삭제를 확인했습니다.").check();
  await page.getByRole("button", { name: "이 양식 삭제" }).click();
  await expect(page.getByText("등록한 양식이 없습니다.", { exact: true })).toBeVisible();
});

test("a wrong file type is refused and a template without text says so", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/templates");
  await page.getByLabel("양식 파일").setInputFiles({
    name: "메모.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a document"),
  });
  await page.getByRole("button", { name: "양식 등록", exact: true }).click();
  await expect(
    page.getByText("파일 형식이나 안전 검사를 통과하지 못했습니다.", { exact: false }),
  ).toBeVisible();
  await register(page, "빈양식.docx", Buffer.from(pack(docx(""))));
  await extracted(page, "꺼낸 후보 0개");
  await expect(page.getByText("글이나 표의 칸을 찾지 못했습니다.", { exact: false })).toBeVisible();
});
