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
  const cells = page.getByText("칸별 변경 보기 (이전 값 → 새 값)");
  const retryStarted = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  let requests = 0;
  await page.route("**/revisions/2/cells", async (route) => {
    if (++requests === 1)
      return route.fulfill({ status: 400, json: { error: { message: "칸별 변경 조회 실패" } } });
    retryStarted.resolve();
    await resume.promise;
    await route.continue();
  });
  await cells.click();
  const comparison = cells.locator("..");
  await expect(comparison.getByRole("alert")).toContainText("칸별 변경 조회 실패");
  await cells.click();
  await cells.click();
  await retryStarted.promise;
  try {
    await expect(comparison.getByRole("alert")).toHaveCount(0);
    await cells.click();
    await cells.click();
    await expect(comparison.getByRole("status")).toBeVisible();
  } finally {
    resume.resolve();
  }
  await expect(page.getByText(/바뀐 칸 \d+개/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /^=SUMIF/ }).first()).toBeVisible();
  expect(requests).toBe(2);

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
  await expect(page.getByText("엑셀 자료 · 버전 2개")).toBeVisible();
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page).toHaveURL(/\/manuals\/[\w-]+\/edit$/);
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
    await expect(reader.getByText(/v2 · .* · 박효민/).filter({ visible: true })).toBeVisible();
    await expect(
      reader.getByText("A. 반품(음수)을 합계에서 빼야 해서 바꿨습니다.").filter({ visible: true }),
    ).toBeVisible();
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

    await reader.goto(`${sourceUrl}?view=shared`);
    await expect(reader.getByRole("link", { name: "v2 원본 내려받기" })).toBeVisible();
    await expect(reader.getByText(/칸별 변경 보기/)).toHaveCount(0);
    await expect(reader.getByRole("link", { name: "v1 원본 내려받기" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("concurrent answers retain both results", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("답변 경합 검증");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  const cards = page.getByRole("group");
  await expect(cards).toHaveCount(2);
  let releaseFirst = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let arrived = () => {};
  const request = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let requests = 0;
  await page.route("**/questions/*", async (route) => {
    const response = await route.fetch();
    if (++requests === 1) {
      arrived();
      await gate;
    }
    await route.fulfill({ response });
  });
  await cards.nth(0).getByLabel("답변").fill("첫 번째 업무 답변");
  await cards.nth(0).getByRole("button", { name: "답변 저장" }).click();
  await request;
  await cards.nth(1).getByLabel("답변").fill("두 번째 출처 답변");
  await cards.nth(1).getByRole("button", { name: "답변 저장" }).click();
  await expect(cards.nth(1).locator("p.answer")).toHaveText("두 번째 출처 답변");
  releaseFirst();
  await expect(cards.nth(0).locator("p.answer")).toHaveText("첫 번째 업무 답변");
  await expect(cards.nth(1).locator("p.answer")).toHaveText("두 번째 출처 답변");
});

test("a failed answer keeps the draft editable and manual errors are visible", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("실패 복구 검증");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  const card = page.getByRole("group").first();
  await card.getByLabel("답변").fill("실패해도 보존할 답변");
  await page.route("**/questions/*", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: "invalid_input", message: "답변 저장 실패" } },
    }),
  );
  await card.getByRole("button", { name: "답변 저장" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(card.getByLabel("답변")).toHaveValue("실패해도 보존할 답변");
  await expect(card.getByRole("button", { name: "답변 저장" })).toBeEnabled();
  await page.unroute("**/questions/*");
  await card.getByRole("button", { name: "답변 저장" }).click();
  await expect(card.locator("p.answer")).toHaveText("실패해도 보존할 답변");
  await page.route("**/api/manuals", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 409,
          json: { error: { code: "conflict", message: "최신 버전 확인 필요" } },
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert").last()).toContainText(
    "최신 버전 확인 필요",
  );
  await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeEnabled();
});

test("a delayed answer does not switch back to an older selection", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("버전 선택 경합 검증");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await page.getByRole("button", { name: "새 버전 올리기" }).click();
  await page.getByLabel("새 버전 엑셀 파일").setInputFiles(fixture("정산_1030.xlsx"));
  await page.getByRole("button", { name: "올리고 비교하기" }).click();
  await expect(page.getByRole("status")).toContainText("v2를 저장했습니다");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = () => {};
  const request = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route("**/questions/*", async (route) => {
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  const card = page.getByRole("group").first();
  await card.getByLabel("답변").fill("늦게 도착하는 답변");
  await card.getByRole("button", { name: "답변 저장" }).click();
  await request;
  await page.getByRole("button", { name: /^v1/ }).click();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible();
  const refreshed = page.waitForResponse((r) => /\/revisions$/.test(r.url()));
  release();
  await refreshed;
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^v1/ })).toHaveAttribute("aria-current", "true");
});

test("a saved upload stays committed when the follow-up read fails", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("저장된 버전 복구");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible();
  let posts = 0;
  await page.route("**/api/sources/**", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      return route.continue();
    }
    return route.fulfill({ status: 400, json: { error: { message: "후속 조회 실패" } } });
  });
  await page.getByRole("button", { name: "새 버전 올리기" }).click();
  const input = page.getByLabel("새 버전 엑셀 파일");
  await input.setInputFiles(fixture("정산_1030.xlsx"));
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/revisions$/.test(r.url()),
  );
  await page.getByRole("button", { name: "올리고 비교하기" }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByRole("status").filter({ hasText: "v2를 저장했습니다" })).toBeVisible();
  await expect(page.getByText("엑셀 자료 · 버전 2개")).toBeVisible();
  await expect(page.getByRole("button", { name: /^v2 · 최신/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("link", { name: "v2 원본 내려받기" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "시트 미리보기를 불러오지 못했습니다",
  );
  await expect(input).toHaveCount(0);
  await page.getByRole("button", { name: "새 버전 올리기" }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: "올리고 비교하기" })).toBeDisabled();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.unroute("**/api/sources/**");
  await page.getByRole("button", { name: "직접 작성하기", exact: true }).click();
  await expect(page).toHaveURL(/\/manuals\/[\w-]+\/edit$/);
  expect(posts).toBe(1);
});

test("registering the next workbook as a new source suggests adding it as a new version", async ({
  page,
}) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("월간 정산");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("heading", { name: "월간 정산", level: 1 })).toBeVisible();
  await expect(page.getByText(/다음에 이 파일 작업을 마치면/)).toBeVisible();
  const sourceUrl = page.url();

  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("10월 정산");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1030.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  const suggestion = page.getByRole("group", { name: "기존 자료의 새 버전인가요?" });
  await expect(suggestion).toContainText("정산_1029.xlsx");
  await suggestion.getByRole("button", { name: "「월간 정산」의 새 버전으로 올리기" }).click();
  await expect(page).toHaveURL(sourceUrl);
  await expect(page.getByRole("button", { name: /^v2/ })).toBeVisible();
  await expect(page.getByText(/다음에 이 파일 작업을 마치면/)).toHaveCount(0);
});

test("the suggestion can be declined to register a separate source", async ({ page }) => {
  await signUpAndVerify(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("월간 정산");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1029.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await expect(page.getByRole("heading", { name: "월간 정산", level: 1 })).toBeVisible();
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("다른 정산");
  await page.getByLabel(/엑셀·TXT·Markdown 파일/).setInputFiles(fixture("정산_1030.xlsx"));
  await page.getByRole("button", { name: "원본 등록" }).click();
  await page.getByRole("button", { name: "새 자료로 등록" }).click();
  await expect(page.getByRole("heading", { name: "다른 정산", level: 1 })).toBeVisible();
});

test("switching files during a workbook lookup discards the previous suggestions", async ({
  page,
}) => {
  await signUpAndVerify(page);
  const file = page.getByLabel(/엑셀·TXT·Markdown 파일/);
  const submit = page.getByRole("button", { name: "원본 등록" });
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("월간 정산");
  await file.setInputFiles(fixture("정산_1029.xlsx"));
  await submit.click();
  await expect(page.getByRole("heading", { name: "월간 정산", level: 1 })).toBeVisible();
  const original = page.url();

  await page.goto("/sources/new");
  await page.getByLabel("자료 제목").fill("다른 업무");
  await file.setInputFiles(fixture("정산_1030.xlsx"));
  const lookedUp = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/sources/similar?**", async (route) => {
    const response = await route.fetch();
    lookedUp.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  await submit.click();
  await lookedUp.promise;
  try {
    await file.setInputFiles({
      name: "인수인계.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "담당자는 매일 입고된 자료를 검토하고 승인 결과를 기록합니다. ".repeat(5),
      ),
    });
  } finally {
    release.resolve();
  }
  await expect(submit).toBeEnabled();
  await expect(page.getByRole("group", { name: "기존 자료의 새 버전인가요?" })).toHaveCount(0);
  await submit.click();
  await expect(page.getByRole("heading", { name: "다른 업무", level: 1 })).toBeVisible();
  await expect(page.getByText("원본 자료 · 버전 1")).toBeVisible();
  await page.goto(original);
  await expect(page.getByText("엑셀 자료 · 버전 1개")).toBeVisible();
});
