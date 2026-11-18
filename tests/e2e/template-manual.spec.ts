import { expect, test } from "@playwright/test";
import { runTemplateJob } from "../../src/lib/template-extraction.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { openAsNewReader, signUpAndVerify, turnOnLinkSharing } from "./helpers";

test("a manual written on a company template is answered item by item, published and read", async ({
  page,
  browser,
}) => {
  await signUpAndVerify(page);
  // 양식 등록 → 직접 입력 → 확정(첫 양식은 기본 양식이 된다).
  await page.getByRole("link", { name: "양식", exact: true }).click();
  await page.getByLabel("양식 파일").setInputFiles({
    name: "인계서.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(pack(docx(wp("인계 사유") + wp("처리 절차")))),
  });
  await page.getByRole("button", { name: "양식 등록", exact: true }).click();
  await expect(async () => {
    while (await runTemplateJob());
    await expect(page.getByRole("heading", { name: "꺼낸 후보 2개" })).toBeVisible({
      timeout: 3000,
    });
  }).toPass();
  await page.getByRole("button", { name: "직접 입력" }).click();
  for (const [index, name] of ["인계 사유", "처리 절차", "비고"].entries()) {
    await page.getByRole("button", { name: "항목 추가" }).click();
    await page.getByLabel(`항목 ${index + 1} 이름`).fill(name);
  }
  await page.getByLabel("항목 1 작성 안내").fill("왜 넘기는지 적습니다");
  await page.getByLabel("항목 2 형태").selectOption("list");
  await page.getByRole("button", { name: "항목 확정" }).click();
  await expect(page.getByText("기본 양식", { exact: true })).toBeVisible();

  // 업무 등록 → 양식을 골라 직접 작성.
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("계정 발급 인계");
  await page
    .getByLabel("업무 내용", { exact: true })
    .fill("승인을 확인하고 업무 계정을 발급합니다. ".repeat(10));
  await page.getByRole("button", { name: "원본 등록", exact: true }).click();
  await expect(page.getByLabel("매뉴얼 항목")).toHaveValue(/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "채우지 못한 항목 3개" })).toBeVisible();
  await expect(page.getByText("양식: 인계서.docx", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "인계 사유 답하기" }).click();
  await expect(page.getByLabel("인계 사유", { exact: true })).toBeFocused();
  await page.getByLabel("인계 사유", { exact: true }).fill("담당자 부서 이동");
  await page.getByLabel("처리 절차", { exact: true }).fill("승인 확인\n\n계정 발급");
  await expect(page.getByRole("heading", { name: "채우지 못한 항목 1개" })).toBeVisible();
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.", { exact: true }),
  ).toBeVisible();

  // 빈 항목이 남으면 게시가 막히고 이름으로 알려 준다.
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  await expect(page.getByText("비어 있는 항목: 비고.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "초안 수정", exact: true }).click();
  await page.getByRole("button", { name: "비고 해당 없음" }).click();
  await expect(page.getByRole("heading", { name: /채우지 못한 항목/ })).toHaveCount(0);
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.getByText("초안을 저장했습니다. 검수 후 게시할 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "검수 화면", exact: true }).click();
  await expect(page.getByRole("heading", { name: "처리 절차", level: 3 }).first()).toBeVisible();
  await page.getByLabel("원본과 업무 내용을 확인했습니다.").check();
  await page.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
  await page.getByRole("button", { name: "검수 완료·버전 게시" }).click();
  await expect(page.getByText("검수 완료 · 버전 1", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 후임자는 양식의 항목 순서대로 읽는다.
  const url = await turnOnLinkSharing(page);
  const { page: readerPage } = await openAsNewReader(browser, url, page.viewportSize());
  const article = readerPage.locator("article.document").last();
  await expect(article.getByRole("heading", { level: 3 })).toHaveText([
    "인계 사유",
    "처리 절차",
    "비고",
    "미확인 항목",
  ]);
  await expect(article.getByText("담당자 부서 이동", { exact: true })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText([
    "승인 확인",
    "계정 발급",
    "담당자가 내용을 작성하고 원본 근거를 확인해야 합니다.",
  ]);
  await expect(article.getByText("해당 없음", { exact: true })).toBeVisible();
});
