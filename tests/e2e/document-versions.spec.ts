import { expect, test } from "@playwright/test";
import { runDocumentJob } from "../../src/lib/document-jobs.ts";
import { readDocument } from "../../src/lib/documents/read.ts";
import { docx, enc, hwpx, pack, pptx, wp } from "../fixtures/documents/native/build.ts";
import { openAsNewReader, signUpAndVerify, turnOnLinkSharing } from "./helpers";

const variants = ["docx", "hwpx", "pptx", "csv"] as const;
function bytes(format: (typeof variants)[number], changed: boolean) {
  const text = changed ? "SAFE_NEW_7391" : "SECRET_OLD_7391";
  if (format === "csv") return enc(`항목,설명\n업무,${text}\n`);
  return pack(format === "docx" ? docx(wp(text)) : format === "hwpx" ? hwpx(text) : pptx(text));
}
async function processQueue() {
  for (let count = 0; count < 30; count++) {
    if (!(await runDocumentJob(async (format, input) => readDocument(format, input)))) return;
  }
  throw new Error("test document queue did not drain");
}
for (const format of variants)
  test(`owner registers, processes and versions ${format}`, async ({ page }, testInfo) => {
    await signUpAndVerify(page);
    await page.goto("/sources/new");
    await page.getByLabel("자료 제목").fill(`합성 문서 ${format}`);
    await page.locator("#source-file").setInputFiles({
      name: `업무.${format}`,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(bytes(format, false)),
    });
    const registered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && /\/api\/sources$/.test(response.url()),
    );
    await page.getByRole("button", { name: "원본 등록", exact: true }).click();
    expect((await registered).status()).toBe(202);
    await expect(
      page.getByRole("heading", { name: `합성 문서 ${format}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeDisabled();
    await processQueue();
    await expect(page.getByText("이 문서는 어떤 업무에 사용하나요?", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible();
    await page.getByRole("button", { name: "새 버전 올리기", exact: true }).click();
    await expect(page.locator("#revision-help")).toContainText(`.${format}, 5 MB`);
    await page.locator("#revision-file").setInputFiles({
      name: `업무.${format}`,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(bytes(format, true)),
    });
    const queuedRevision = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/revisions$/.test(response.url()),
    );
    await page.getByRole("button", { name: "올리고 비교하기", exact: true }).click();
    expect((await queuedRevision).status()).toBe(202);
    await processQueue();
    await expect(page.getByRole("heading", { name: /v1과 비교해 바뀐 부분 [1-9]/ })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("status")).not.toContainText(
      "완료 후 질문과 비교 결과를 표시합니다",
    );
    await page.getByText(/내용 변경 1\s*건/, { exact: true }).click();
    await expect(page.getByText("SECRET_OLD_7391", { exact: false }).last()).toBeVisible();
    await expect(
      page.getByText("SAFE_NEW_7391", { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`document-${format}.png`), fullPage: true });
  });
test("published document Reader cannot request owner-only previous content", async ({
  page,
  browser,
}) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("게시 문서 권한 검증");
  await page.locator("#source-file").setInputFiles({
    name: "권한.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes("docx", false)),
  });
  const registered = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/api\/sources$/.test(response.url()),
  );
  await page.getByRole("button", { name: "원본 등록", exact: true }).click();
  expect((await registered).status()).toBe(202);
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]{36}$/);
  const sourceId = page.url().split("/").pop();
  await processQueue();
  await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeEnabled({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "새 버전 올리기", exact: true }).click();
  await page.locator("#revision-file").setInputFiles({
    name: "권한.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes("docx", true)),
  });
  const queuedRevision = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/revisions$/.test(response.url()),
  );
  await page.getByRole("button", { name: "올리고 비교하기", exact: true }).click();
  expect((await queuedRevision).status()).toBe(202);
  await processQueue();
  await expect(page.getByRole("link", { name: "v2 원본 내려받기" })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page).toHaveURL(/\/manuals\/[\w-]+\/edit$/);
  const manualUrl = page.url().replace(/\/edit$/, "");
  await page.getByLabel("업무 목적", { exact: true }).fill("합성 업무를 인계합니다.");
  await page.getByLabel("업무 순서", { exact: true }).fill("현재 게시된 절차만 확인합니다.");
  await page.getByLabel("완료 기준", { exact: true }).fill("원본을 확인했습니다.");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.")).toBeVisible();
  await page.goto(manualUrl);
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  const url = await turnOnLinkSharing(page);
  const origin = new URL(url).origin;
  const { context, page: reader } = await openAsNewReader(browser, url, page.viewportSize());
  try {
    const response = await reader.request.get(
      `${origin}/api/sources/${sourceId}/revisions/2/document?view=shared`,
    );
    expect([403, 404]).toContain(response.status());
    await reader.goto(`${origin}/sources/${sourceId}?view=shared`);
    await expect(reader.getByText("추출 내용·문서 변경 보기", { exact: true })).toHaveCount(0);
    await expect(reader.getByText("SECRET_OLD_7391", { exact: false })).toHaveCount(0);
    const detail = await reader.request.get(
      `${origin}/api/sources/${sourceId}/revisions/2?view=shared`,
    );
    expect(await detail.text()).not.toContain("SECRET_OLD_7391");
  } finally {
    await context.close();
  }
});
