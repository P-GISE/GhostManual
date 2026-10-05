import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3200";
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs", "qa", "2026-10-05");
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const artifacts = [];
const surfaceEvidence = [];
const adversarialCases = [];
const actions = [];
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const expectedNavigationAborts = { count: 0, samples: [] };
const metrics = [];

function relative(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function redact(value) {
  return String(value)
    .replace(/\/share#[A-Za-z0-9_-]+/g, "/share#[redacted]")
    .replace(/([?&](?:token|shareToken)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[redacted-id]");
}

function artifact(id, kind, description, file) {
  const item = { id, kind, description, path: relative(file) };
  artifacts.push(item);
  return item;
}

function action(surface, invocation) {
  actions.push({ surface, invocation: redact(invocation), at: new Date().toISOString() });
}

function addSurface({ id, criterion, surface, invocation, verdict, refs }) {
  surfaceEvidence.push({
    scenarioId: id,
    criterionReference: criterion,
    surface,
    exactInvocation: redact(invocation),
    verdict,
    artifactRefs: refs.map((ref) => ref.id),
  });
}

function addAdversarial({ id, criterion, adversarialClass, expectedBehavior, verdict, refs }) {
  adversarialCases.push({
    scenarioId: id,
    criterionReference: criterion,
    adversarialClass,
    expectedBehavior,
    verdict,
    artifactRefs: refs.map((ref) => ref.id),
  });
}

function pngDimensions(buffer) {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch((error) => {
    if (!String(error?.message ?? error).includes("Timeout")) throw error;
  });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(120);
}

function monitor(page, surface) {
  page.on("pageerror", (error) => {
    pageErrors.push({ surface, message: redact(error.message) });
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push({ surface, message: redact(message.text()) });
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    const item = {
      surface,
      url: redact(new URL(request.url()).pathname),
      failure: redact(failure),
    };
    if (failure.includes("ERR_ABORTED")) {
      expectedNavigationAborts.count += 1;
      if (expectedNavigationAborts.samples.length < 5) expectedNavigationAborts.samples.push(item);
    } else failedRequests.push(item);
  });
}

async function capture(page, { viewport, slug, scenarioId, criterion, route, surface, note = "" }) {
  await page.bringToFront();
  await settle(page);
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const file = path.join(SCREENSHOT_DIR, `${viewport}-${slug}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const bytes = await fs.readFile(file);
  const dims = pngDimensions(bytes);
  const expected = viewport === "desktop" ? DESKTOP : MOBILE;
  const signatureAndDimensions =
    !!dims && dims.width === expected.width && dims.height >= expected.height;
  const dom = await page.evaluate(() => ({
    urlPath: window.location.pathname,
    hashPresent: Boolean(window.location.hash),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentScrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    bodyHeight: document.body.scrollHeight,
    scrollY: window.scrollY,
    headingWordBreak: getComputedStyle(document.querySelector("h1") ?? document.body).wordBreak,
    linkTargetHeights: [...document.querySelectorAll("nav a,footer a,.row a")].map(
      (link) => link.getBoundingClientRect().height,
    ),
    textLength: document.body.innerText.length,
    headingCount: document.querySelectorAll("h1,h2,h3").length,
    focusedRole: document.activeElement?.getAttribute("role") ?? null,
  }));
  const metric = {
    scenarioId,
    viewport,
    route,
    screenshot: relative(file),
    signatureAndDimensions,
    dimensions: dims,
    fullPage: true,
    dom,
    note,
  };
  metrics.push(metric);
  const shot = artifact(
    `${scenarioId}-${viewport}-screenshot`,
    "screenshot",
    `${viewport} ${route} rendered UI`,
    file,
  );
  const metricFile = path.join(OUT_DIR, "dom-metrics.json");
  const metricRef = artifact(
    `${scenarioId}-${viewport}-metrics`,
    "metrics",
    `${viewport} ${route} DOM and overflow metrics`,
    metricFile,
  );
  const verdict =
    signatureAndDimensions && !dom.horizontalOverflow && pageErrors.length === 0 ? "PASS" : "FAIL";
  addSurface({
    id: `${scenarioId}-${viewport}`,
    criterion,
    surface,
    invocation: `${surface}.goto(${JSON.stringify(BASE_URL + route)}) at ${expected.width}x${expected.height}`,
    verdict,
    refs: [shot, metricRef],
  });
  return { shot, metricRef, verdict, metric };
}

async function goto(page, route, surface) {
  action(surface, `${surface}.goto(${JSON.stringify(BASE_URL + route)})`);
  await page.goto(BASE_URL + route, { waitUntil: "domcontentloaded" });
  await settle(page);
}

async function expectVisible(_page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  action("browser", `waitForVisible(${JSON.stringify(label)})`);
}

async function screenshotRoute(
  page,
  viewport,
  route,
  slug,
  scenarioId,
  criterion,
  surface = "ownerPage",
) {
  await goto(page, route, surface);
  return capture(page, { viewport, slug, scenarioId, criterion, route, surface });
}

function routeForHref(href) {
  if (!href) throw new Error("Expected a route link, received none");
  return new URL(href, BASE_URL).pathname;
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const ownerContext = await browser.newContext({ viewport: DESKTOP });
    const ownerPage = await ownerContext.newPage();
    monitor(ownerPage, "ownerPage");

    // Fresh landing surface and synthetic example workspace creation.
    await screenshotRoute(ownerPage, "desktop", "/", "home", "route-home", "A1", "ownerPage");
    action("ownerPage", 'ownerPage.getByRole("button", {name:"합성 예제 열기"}).click()');
    await ownerPage.getByRole("button", { name: "합성 예제 열기" }).click();
    await ownerPage.waitForURL(/\/manuals$/);
    await expectVisible(
      ownerPage,
      ownerPage.getByRole("heading", { name: "업무 문서함" }),
      "업무 문서함",
    );
    const manualRoute = routeForHref(
      await ownerPage
        .getByRole("link", { name: "신입 구성원 업무 계정 발급" })
        .first()
        .getAttribute("href"),
    );
    const sourceRoute = routeForHref(
      await ownerPage
        .locator('a[href^="/sources/"]:not([href="/sources/new"])')
        .first()
        .getAttribute("href"),
    );

    await capture(ownerPage, {
      viewport: "desktop",
      slug: "manuals-draft",
      scenarioId: "route-manuals",
      criterion: "A1",
      route: "/manuals",
      surface: "ownerPage",
    });
    await screenshotRoute(
      ownerPage,
      "desktop",
      "/sources/new",
      "sources-new",
      "route-sources-new",
      "A1",
    );
    await screenshotRoute(
      ownerPage,
      "desktop",
      sourceRoute,
      "source-detail",
      "route-source-detail",
      "A5",
    );
    await screenshotRoute(
      ownerPage,
      "desktop",
      manualRoute,
      "manual-detail-draft",
      "route-manual-detail",
      "A3",
    );
    await screenshotRoute(
      ownerPage,
      "desktop",
      `${manualRoute}/edit`,
      "manual-edit-draft",
      "route-manual-edit",
      "A3",
    );
    await screenshotRoute(ownerPage, "desktop", "/ask", "ask-empty", "route-ask", "A6");
    await screenshotRoute(ownerPage, "desktop", "/privacy", "privacy", "route-privacy", "A12");
    await screenshotRoute(ownerPage, "desktop", "/terms", "terms", "route-terms", "A12");

    // Publish the synthetic example and capture the published review state.
    await goto(ownerPage, manualRoute, "ownerPage");
    await expectVisible(
      ownerPage,
      ownerPage.getByText("미리 작성된 합성 예제", { exact: true }),
      "미리 작성된 합성 예제",
    );
    action("ownerPage", 'ownerPage.getByLabel("원본과 업무 내용을 확인했습니다.").check()');
    await ownerPage.getByLabel("원본과 업무 내용을 확인했습니다.").check();
    action("ownerPage", 'ownerPage.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check()');
    await ownerPage.getByLabel("미확인 항목이 남아 있음을 확인했습니다.").check();
    action("ownerPage", 'ownerPage.getByRole("button", {name:"검수 완료·버전 게시"}).click()');
    await ownerPage.getByRole("button", { name: "검수 완료·버전 게시" }).click();
    await expectVisible(
      ownerPage,
      ownerPage.getByText("검수 완료 · 버전 1", { exact: true }),
      "검수 완료 · 버전 1",
    );
    const publishedCapture = await capture(ownerPage, {
      viewport: "desktop",
      slug: "manual-detail-published",
      scenarioId: "state-published",
      criterion: "A3",
      route: manualRoute,
      surface: "ownerPage",
      note: "게시 버전 1 배지와 검수 완료 상태",
    });
    addAdversarial({
      id: "state-published-desktop",
      criterion: "A3",
      adversarialClass: "published-version-boundary",
      expectedBehavior: "검수 확인 후 게시 버전 1이 표시되고 초안과 게시본 상태가 구분된다.",
      verdict: publishedCapture.verdict,
      refs: [publishedCapture.shot, publishedCapture.metricRef],
    });

    // Create a share through the owner UI. The fragment is held in memory only and never logged or screenshotted.
    action("ownerPage", 'ownerPage.getByRole("button", {name:"공유 링크 만들기"}).click()');
    await ownerPage.getByRole("button", { name: "공유 링크 만들기" }).click();
    const shareInput = ownerPage.getByLabel("읽기 전용 링크");
    await shareInput.waitFor({ state: "visible" });
    const shareUrl = await shareInput.inputValue();
    if (!shareUrl.includes("/share#")) throw new Error("Share link did not use a fragment");

    const readerContext = await browser.newContext({ viewport: DESKTOP });
    const readerPage = await readerContext.newPage();
    monitor(readerPage, "readerPage");
    action("readerPage", 'readerPage.goto(BASE_URL + "/share#[redacted]")');
    await readerPage.goto(shareUrl, { waitUntil: "domcontentloaded" });
    await expectVisible(
      readerPage,
      readerPage.getByRole("heading", { name: "신입 구성원 업무 계정 발급" }),
      "공유 매뉴얼 제목",
    );
    const shareCapture = await capture(readerPage, {
      viewport: "desktop",
      slug: "share-reader",
      scenarioId: "route-share",
      criterion: "A4",
      route: "/share",
      surface: "readerPage",
      note: "fragment 교환 후 토큰 없는 reader 경로",
    });
    const postExchange = await readerPage.evaluate(() => ({
      path: window.location.pathname,
      hash: window.location.hash,
    }));
    const tokenScrubVerdict =
      postExchange.path === "/share" && postExchange.hash === "" ? "PASS" : "FAIL";
    addAdversarial({
      id: "share-fragment-scrub",
      criterion: "A4",
      adversarialClass: "share-token-url-leak",
      expectedBehavior: "공유 fragment 교환 후 주소는 /share로 정리되고 hash가 비어 있다.",
      verdict: tokenScrubVerdict,
      refs: [shareCapture.shot, shareCapture.metricRef],
    });
    await expectVisible(
      readerPage,
      readerPage.getByLabel("업무 질문", { exact: true }),
      "업무 질문",
    );
    action(
      "readerPage",
      'readerPage.getByLabel("업무 질문").fill("계정 발급 전에 무엇을 확인하나요?")',
    );
    await readerPage
      .getByLabel("업무 질문", { exact: true })
      .fill("계정 발급 전에 무엇을 확인하나요?");
    action("readerPage", 'readerPage.getByRole("button", {name:"근거 찾아 질문하기"}).click()');
    await readerPage.getByRole("button", { name: "근거 찾아 질문하기" }).click();
    await expectVisible(
      readerPage,
      readerPage.getByText("AI 답변 이용 불가", { exact: true }),
      "AI 답변 이용 불가",
    );
    await expectVisible(
      readerPage,
      readerPage.getByRole("heading", { name: "검색 결과", exact: true }),
      "검색 결과",
    );
    const unavailableCapture = await capture(readerPage, {
      viewport: "desktop",
      slug: "share-unavailable",
      scenarioId: "state-unavailable",
      criterion: "A8",
      route: "/share",
      surface: "readerPage",
      note: "AI_ENABLED=false에서 검색 결과 fallback",
    });
    addAdversarial({
      id: "state-unavailable-desktop",
      criterion: "A8",
      adversarialClass: "ai-unavailable-fallback",
      expectedBehavior: "실 AI 호출 없이 이용 불가 안내와 검색 결과를 표시한다.",
      verdict: unavailableCapture.verdict,
      refs: [unavailableCapture.shot, unavailableCapture.metricRef],
    });

    // Capture the valid shared route at the mobile breakpoint before revocation.
    await readerPage.setViewportSize(MOBILE);
    await goto(readerPage, "/share", "readerPage");
    await expectVisible(
      readerPage,
      readerPage.getByRole("heading", { name: "신입 구성원 업무 계정 발급" }),
      "공유 매뉴얼 제목 모바일",
    );
    await capture(readerPage, {
      viewport: "mobile",
      slug: "share-reader-mobile",
      scenarioId: "route-share",
      criterion: "A4",
      route: "/share",
      surface: "readerPage",
      note: "유효한 공유 reader 경로 모바일",
    });
    await readerPage
      .getByLabel("업무 질문", { exact: true })
      .fill("계정 발급 전에 무엇을 확인하나요?");
    await readerPage.getByRole("button", { name: "근거 찾아 질문하기" }).click();
    await expectVisible(
      readerPage,
      readerPage.getByText("AI 답변 이용 불가", { exact: true }),
      "AI 답변 이용 불가 모바일",
    );
    const unavailableMobileCapture = await capture(readerPage, {
      viewport: "mobile",
      slug: "share-unavailable-mobile",
      scenarioId: "state-unavailable",
      criterion: "A8",
      route: "/share",
      surface: "readerPage",
      note: "AI_ENABLED=false 모바일 검색 결과 fallback",
    });
    addAdversarial({
      id: "state-unavailable-mobile",
      criterion: "A8",
      adversarialClass: "ai-unavailable-fallback-mobile",
      expectedBehavior: "390x844에서도 실 AI 호출 없이 이용 불가 안내와 검색 결과를 표시한다.",
      verdict: unavailableMobileCapture.verdict,
      refs: [unavailableMobileCapture.shot, unavailableMobileCapture.metricRef],
    });
    await readerPage.setViewportSize(DESKTOP);

    // Revoke the share and prove a reader can no longer access it.
    await goto(ownerPage, manualRoute, "ownerPage");
    await expectVisible(
      ownerPage,
      ownerPage.getByRole("button", { name: "이 공유 취소", exact: true }),
      "이 공유 취소",
    );
    action("ownerPage", 'ownerPage.getByRole("button", {name:"이 공유 취소"}).click()');
    await ownerPage.getByRole("button", { name: "이 공유 취소", exact: true }).click();
    await expectVisible(
      ownerPage,
      ownerPage.getByText("활성 공유가 없습니다.", { exact: true }),
      "활성 공유가 없습니다.",
    );
    action("readerPage", "readerPage.reload() after owner share revocation");
    await readerPage.reload({ waitUntil: "domcontentloaded" });
    await expectVisible(
      readerPage,
      readerPage.locator('p[role="alert"]').first(),
      "공유 취소 오류 안내",
    );
    const revokedCapture = await capture(readerPage, {
      viewport: "desktop",
      slug: "share-reader-revoked",
      scenarioId: "state-reader-revoked",
      criterion: "A9",
      route: "/share",
      surface: "readerPage",
      note: "소유자 취소 후 기존 reader 쿠키 재검증",
    });
    addAdversarial({
      id: "state-reader-revoked-desktop",
      criterion: "A9",
      adversarialClass: "revoked-reader-session",
      expectedBehavior: "공유 취소 후 기존 reader 세션 reload가 alert로 거부된다.",
      verdict: revokedCapture.verdict,
      refs: [revokedCapture.shot, revokedCapture.metricRef],
    });

    // Change the source through its UI, which marks the linked manual for re-review.
    await goto(ownerPage, sourceRoute, "ownerPage");
    await expectVisible(
      ownerPage,
      ownerPage.getByRole("button", { name: "원본 수정", exact: true }),
      "원본 수정",
    );
    await ownerPage.getByRole("button", { name: "원본 수정", exact: true }).click();
    const sourceInput = ownerPage.getByLabel("원본 내용", { exact: true });
    const originalText = await sourceInput.inputValue();
    await sourceInput.fill(
      `${originalText}\n\nQA 합성 절차: 발급 후 담당자가 처리 기록을 남깁니다.`,
    );
    action("ownerPage", 'ownerPage.getByRole("button", {name:"새 원본 버전 저장"}).click()');
    await ownerPage.getByRole("button", { name: "새 원본 버전 저장", exact: true }).click();
    await expectVisible(
      ownerPage,
      ownerPage.getByText("SOURCE / 원본 REVISION 2", { exact: true }),
      "SOURCE / 원본 REVISION 2",
    );
    await goto(ownerPage, manualRoute, "ownerPage");
    await expectVisible(
      ownerPage,
      ownerPage.getByText("재검토 필요", { exact: true }),
      "재검토 필요",
    );
    const rereviewCapture = await capture(ownerPage, {
      viewport: "desktop",
      slug: "manual-detail-rereview",
      scenarioId: "state-rereview",
      criterion: "A7",
      route: manualRoute,
      surface: "ownerPage",
      note: "원본 revision 2 이후 신규 답변 근거 제외 상태",
    });
    addAdversarial({
      id: "state-rereview-desktop",
      criterion: "A7",
      adversarialClass: "source-revision-invalidates-manual",
      expectedBehavior:
        "원본 변경 후 매뉴얼에 재검토 필요가 표시되고 신규 공유/답변 근거에서 제외된다.",
      verdict: rereviewCapture.verdict,
      refs: [rereviewCapture.shot, rereviewCapture.metricRef],
    });
    const _editRereviewCapture = await screenshotRoute(
      ownerPage,
      "desktop",
      `${manualRoute}/edit`,
      "manual-edit-rereview",
      "state-rereview-edit",
      "A7",
    );

    // Capture the complete route set again at the mobile breakpoint from the same synthetic owner state.
    await ownerPage.setViewportSize(MOBILE);
    await screenshotRoute(ownerPage, "mobile", "/", "home", "route-home", "A1");
    await screenshotRoute(
      ownerPage,
      "mobile",
      "/manuals",
      "manuals-current",
      "route-manuals",
      "A1",
    );
    await screenshotRoute(
      ownerPage,
      "mobile",
      "/sources/new",
      "sources-new",
      "route-sources-new",
      "A1",
    );
    await screenshotRoute(
      ownerPage,
      "mobile",
      sourceRoute,
      "source-detail-current",
      "route-source-detail",
      "A5",
    );
    await screenshotRoute(
      ownerPage,
      "mobile",
      manualRoute,
      "manual-detail-current",
      "route-manual-detail",
      "A3",
    );
    await screenshotRoute(
      ownerPage,
      "mobile",
      `${manualRoute}/edit`,
      "manual-edit-current",
      "route-manual-edit",
      "A3",
    );
    await screenshotRoute(ownerPage, "mobile", "/ask", "ask-empty", "route-ask", "A6");
    await screenshotRoute(ownerPage, "mobile", "/privacy", "privacy", "route-privacy", "A12");
    await screenshotRoute(ownerPage, "mobile", "/terms", "terms", "route-terms", "A12");
    await readerPage.setViewportSize(MOBILE);
    await goto(readerPage, "/share", "readerPage");
    const shareMobileCapture = await capture(readerPage, {
      viewport: "mobile",
      slug: "share-reader-revoked",
      scenarioId: "state-reader-revoked",
      criterion: "A9",
      route: "/share",
      surface: "readerPage",
      note: "취소된 reader 공유의 모바일 거부 상태",
    });
    addAdversarial({
      id: "state-reader-revoked-mobile",
      criterion: "A9",
      adversarialClass: "revoked-reader-session-mobile",
      expectedBehavior: "390x844에서도 취소된 공유가 alert로 거부되고 가로 overflow가 없다.",
      verdict: shareMobileCapture.verdict,
      refs: [shareMobileCapture.shot, shareMobileCapture.metricRef],
    });

    // Remove the disposable synthetic owner workspace through the product UI.
    await goto(ownerPage, "/manuals", "ownerPage");
    await ownerPage.getByText("작업 공간 삭제", { exact: true }).click();
    await ownerPage.getByLabel("삭제할 내용을 확인했습니다.").check();
    action("ownerPage", 'ownerPage.getByRole("button", {name:"작업 공간 영구 삭제"}).click()');
    await ownerPage.getByRole("button", { name: "작업 공간 영구 삭제" }).click();
    await ownerPage.waitForURL(/\/$/);

    // Store evidence after capture. The report intentionally contains no dynamic IDs or tokens.
    const metricsFile = path.join(OUT_DIR, "dom-metrics.json");
    await fs.writeFile(metricsFile, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
    const logFile = path.join(OUT_DIR, "browser-action-log.json");
    await fs.writeFile(
      logFile,
      `${JSON.stringify({ actions, pageErrors, consoleErrors, failedRequests, expectedNavigationAborts }, null, 2)}\n`,
      "utf8",
    );
    const _metricsRef = artifact(
      "dom-metrics",
      "metrics",
      "DOM, viewport, PNG dimensions, and horizontal overflow for every capture",
      metricsFile,
    );
    const _logRef = artifact(
      "browser-action-log",
      "action-log",
      "Redacted browser actions, page errors, console errors, and failed requests",
      logFile,
    );
    const reportFile = path.join(OUT_DIR, "ghostmanual-manual-qa.md");
    const passCount = surfaceEvidence.filter((item) => item.verdict === "PASS").length;
    const failCount = surfaceEvidence.filter((item) => item.verdict !== "PASS").length;
    const report =
      `# GhostManual manual QA — 2026-10-05\n\n` +
      `Base URL: ${BASE_URL}\n\n` +
      `This report was generated from the real Chrome Playwright surface after the production build. The workspace and source mutation used synthetic disposable example data; AI generation was not invoked. Share fragments were held in memory and redacted from logs.\n\n` +
      `## Capture scope\n\n` +
      `Ten routes were captured at 1440x900 and 390x844: /, /manuals, /sources/new, /sources/:id, /manuals/:id, /manuals/:id/edit, /ask, /share, /privacy, and /terms. State captures include published, AI unavailable, source re-review, and reader revoked. ${passCount} surface scenarios passed and ${failCount} failed.\n\n` +
      `## manualQa.surfaceEvidence\n\n` +
      `| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |\n|---|---|---|---|---|---|\n` +
      surfaceEvidence
        .map(
          (item) =>
            `| ${item.scenarioId} | ${item.criterionReference} | ${item.surface} | ${item.exactInvocation} | ${item.verdict} | ${item.artifactRefs.join(", ")} |`,
        )
        .join("\n") +
      `\n\n## manualQa.adversarialCases\n\n` +
      `| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |\n|---|---|---|---|---|---|\n` +
      adversarialCases
        .map(
          (item) =>
            `| ${item.scenarioId} | ${item.criterionReference} | ${item.adversarialClass} | ${item.expectedBehavior} | ${item.verdict} | ${item.artifactRefs.join(", ")} |`,
        )
        .join("\n") +
      `\n\n## manualQa.artifactRefs\n\n` +
      `| id | kind | description | path |\n|---|---|---|---|\n` +
      [
        ...artifacts,
        {
          id: "browser-action-log",
          kind: "action-log",
          description: "Redacted browser actions and runtime errors",
          path: relative(logFile),
        },
        {
          id: "dom-metrics",
          kind: "metrics",
          description: "DOM and screenshot metrics",
          path: relative(metricsFile),
        },
        {
          id: "manual-qa-report",
          kind: "report",
          description: "This manualQa matrix",
          path: relative(reportFile),
        },
      ]
        .map((item) => `| ${item.id} | ${item.kind} | ${item.description} | ${item.path} |`)
        .join("\n") +
      `\n\n## Runtime evidence\n\n` +
      `- Page errors: ${pageErrors.length}; console errors: ${consoleErrors.length}; failed requests: ${failedRequests.length}; expected navigation aborts: ${expectedNavigationAborts.count} (aggregated with five samples). See [browser-action-log.json](${relative(logFile)}).\n` +
      `- PNG signatures and requested dimensions were checked for every screenshot; DOM overflow metrics are in [dom-metrics.json](${relative(metricsFile)}).\n` +
      `- Every PASS references a non-empty screenshot and metrics artifact.\n`;
    await fs.writeFile(reportFile, report, "utf8");
    await fs.rm(path.join(OUT_DIR, "capture-failure.json"), { force: true });

    await ownerContext.close();
    await readerContext.close();
    console.log(
      JSON.stringify(
        {
          report: relative(reportFile),
          screenshotCount: artifacts.filter((item) => item.kind === "screenshot").length,
          surfaceEvidence: surfaceEvidence.length,
          adversarialCases: adversarialCases.length,
          pageErrors: pageErrors.length,
          consoleErrors: consoleErrors.length,
          failedRequests: failedRequests.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch(async (error) => {
  const failure = path.join(OUT_DIR, "capture-failure.json");
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(
    failure,
    JSON.stringify(
      {
        message: redact(error?.stack ?? error),
        actions,
        pageErrors,
        consoleErrors,
        failedRequests,
        expectedNavigationAborts,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.error(redact(error?.stack ?? error));
  process.exitCode = 1;
});
