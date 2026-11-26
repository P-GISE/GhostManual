import { expect, test } from "@playwright/test";
import { runTemplateJob } from "../../src/lib/template-extraction.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { signUpAndVerify } from "./helpers";

test("owner checks candidates, enters items by hand and confirms the default template", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await page.getByRole("tab", { name: "양식", exact: true }).click();
  await page.getByLabel("양식 파일").setInputFiles({
    name: "인계서.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(pack(docx(wp("업무 목적") + wp("홍길동") + wp("완료 기준")))),
  });
  await page.getByRole("button", { name: "양식 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
  // 화면의 상태 재조회가 문서함 행을 잡은 순간에는 워커가 작업을 건너뛰므로 보일 때까지 다시 돌린다.
  await expect(async () => {
    while (await runTemplateJob());
    await expect(page.getByRole("heading", { name: "꺼낸 후보 3개" })).toBeVisible({
      timeout: 3000,
    });
  }).toPass();
  await page.getByLabel("홍길동").uncheck();
  await expect(page.getByText("지금 2개를 골랐습니다.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "전체 해제" }).click();
  await expect(page.getByRole("button", { name: "AI로 항목 정리" })).toBeDisabled();
  await page.getByRole("button", { name: "전체 선택" }).click();
  await page.getByLabel("홍길동").uncheck();
  // E2E 서버는 AI가 꺼져 있다. 안내를 보여 주고 직접 입력으로 이어진다.
  await page.getByRole("button", { name: "AI로 항목 정리" }).click();
  await expect(
    page.getByText("AI가 비활성화되어 있습니다. 항목을 직접 입력할 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "직접 입력" }).click();
  await expect(page.getByRole("button", { name: "항목 확정" })).toBeDisabled();
  await page.getByRole("button", { name: "항목 추가" }).click();
  await page.getByLabel("항목 1 이름").fill("완료 기준");
  await page.getByRole("button", { name: "항목 추가" }).click();
  await page.getByLabel("항목 2 이름").fill("업무 목적");
  await page.getByLabel("항목 2 작성 안내").fill("이 업무를 왜 하는지");
  await page.getByRole("button", { name: "항목 2 위로" }).click();
  await expect(page.getByLabel("항목 1 이름")).toHaveValue("업무 목적");
  await page.getByLabel("항목 2 형태").selectOption("list");
  await page.getByRole("button", { name: "항목 확정" }).click();
  await expect(
    page.getByText("항목을 확정했습니다. 이제 이 양식을 쓸 수 있습니다.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("기본 양식", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByLabel("항목 1 이름")).toHaveValue("업무 목적");
  await expect(page.getByLabel("항목 2 형태")).toHaveValue("list");
  await page.getByRole("link", { name: "양식 목록" }).click();
  await expect(page.getByText("사용 가능", { exact: true })).toBeVisible();
  await expect(page.getByText("항목 2개", { exact: true })).toBeVisible();
});

test("setting a default template preserves unsaved item edits", async ({ page }) => {
  await signUpAndVerify(page);
  const id = crypto.randomUUID();
  const stored = {
    id,
    name: "합성 양식",
    status: "ready",
    isDefault: false,
    extraction: null,
    items: [{ id: "completion", name: "완료 기준", guide: "", kind: "text" }],
  };
  await page.route("**/api/templates/" + id, async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({ isDefault: true });
      await route.fulfill({ json: { ...stored, isDefault: true } });
    } else await route.fulfill({ json: stored });
  });
  await page.goto("/templates/" + id);
  await page.getByLabel("항목 1 이름").fill("편집 중인 완료 기준");
  await page.getByRole("button", { name: "기본 양식으로 지정", exact: true }).click();
  await expect(page.getByText("기본 양식으로 지정했습니다.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("항목 1 이름")).toHaveValue("편집 중인 완료 기준");
});

test("template polling recovers after a temporary server error", async ({ page }) => {
  await signUpAndVerify(page);
  const id = crypto.randomUUID();
  let attempts = 0;
  await page.route("**/api/templates/" + id, async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 503,
        json: { error: { message: "잠시 후 다시 시도하세요." } },
      });
    else
      await route.fulfill({
        json: {
          id,
          name: "합성 양식",
          status: "review",
          isDefault: false,
          items: [],
          extraction: { warnings: [], candidates: [] },
        },
      });
  });
  await page.goto("/templates/" + id);
  await expect(page.getByRole("heading", { name: "꺼낸 후보 0개", exact: true })).toBeVisible({
    timeout: 10000,
  });
  expect(attempts).toBeGreaterThan(1);
  await expect(page.locator(".error[role=alert]")).toHaveCount(0);
});

test("template save locks item edits and failure retains navigation protection", async ({
  page,
}) => {
  await signUpAndVerify(page);
  const id = crypto.randomUUID();
  const stored = {
    id,
    name: "합성 양식",
    status: "ready",
    isDefault: true,
    extraction: null,
    items: [{ id: "completion", name: "완료 기준", guide: "", kind: "text" }],
  };
  let release = () => {};
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/templates/" + id, async (route) => {
    if (route.request().method() === "PATCH") {
      await response;
      await route.fulfill({ status: 503, json: { error: { message: "시험 저장 실패" } } });
    } else await route.fulfill({ json: stored });
  });
  await page.goto("/templates/" + id);
  await page.getByLabel("항목 1 이름").fill("유지할 항목");
  await page.getByRole("button", { name: "항목 확정", exact: true }).click();
  try {
    await expect(page.getByLabel("항목 1 이름")).toBeDisabled();
    await expect(page.getByLabel("항목 1 작성 안내")).toBeDisabled();
    await expect(page.getByLabel("항목 1 형태")).toBeDisabled();
    await expect(page.getByRole("button", { name: "항목 추가", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "항목 1 지우기", exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByText("시험 저장 실패", { exact: true })).toBeVisible();
  await expect(page.getByLabel("항목 1 이름")).toBeEnabled();
  await expect(page.getByLabel("항목 1 이름")).toHaveValue("유지할 항목");
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "양식 목록", exact: true }).click();
  await expect(page).toHaveURL("/templates/" + id);
});
