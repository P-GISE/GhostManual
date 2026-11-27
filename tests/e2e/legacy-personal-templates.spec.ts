import { expect, test } from "@playwright/test";
import { runTemplateJob } from "../../src/lib/template-extraction.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { signUpAndVerify } from "./helpers";

test("an existing personal template remains reachable, editable and deletable without new personal upload", async ({
  page,
}) => {
  await signUpAndVerify(page, undefined, "합성 개인 양식 담당자", false);
  // Seed a pre-transition template without creating any personal work.
  const response = await page.request.post("/api/templates", {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      file: {
        name: "기존개인양식.docx",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(pack(docx(wp("업무 목적") + wp("완료 기준")))),
      },
    },
  });
  expect(response.status()).toBe(202);
  const { id } = await response.json();
  await expect(async () => {
    while (await runTemplateJob());
    const state = await (await page.request.get(`/api/templates/${id}`)).json();
    expect(state.status).toBe("review");
  }).toPass();
  await page.goto("/library");
  await page.getByRole("link", { name: "기존 개인 양식", exact: true }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByRole("heading", { name: "기존 개인 양식", exact: true })).toBeVisible();
  await expect(page.getByLabel("양식 파일")).toHaveCount(0);
  await page.getByRole("link", { name: "기존개인양식.docx", exact: true }).click();
  await expect(page.getByRole("heading", { name: "꺼낸 후보 2개", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.getByRole("button", { name: "항목 추가", exact: true }).click();
  await page.getByLabel("항목 1 이름", { exact: true }).fill("합성 보존 항목");
  await page.getByRole("button", { name: "항목 확정", exact: true }).click();
  await expect(
    page.getByText("항목을 확정했습니다. 이제 이 양식을 쓸 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "양식 목록", exact: true }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await page.getByRole("link", { name: "기존개인양식.docx", exact: true }).click();
  await expect(page.getByLabel("항목 1 이름", { exact: true })).toHaveValue("합성 보존 항목");
  await page.getByLabel("이 양식의 영구 삭제를 확인했습니다.").check();
  await page.getByRole("button", { name: "이 양식 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByText("등록한 양식이 없습니다.", { exact: true })).toBeVisible();
});
