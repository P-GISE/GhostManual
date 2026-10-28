import { expect, test } from "@playwright/test";

for (const path of ["/login", "/signup", "/sources/new", "/ask", "/terms", "/privacy"]) {
  test(`reading and form columns have equal outer margins: ${path}`, async ({ page }) => {
    await page.goto(path);
    const column = page.locator("main > .prose");
    await expect(column).toBeVisible();
    const imbalance = await column.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return Math.abs(bounds.left - (window.innerWidth - bounds.right));
    });
    expect(imbalance).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("Korean interface uses a successfully loaded local web font", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => {
    const family = getComputedStyle(document.body).fontFamily;
    return [...document.fonts].some(
      (face) => face.status === "loaded" && family.includes(face.family.replaceAll('"', "")),
    );
  });
  expect(loaded).toBe(true);
});

test("header, content and footer share their horizontal baseline", async ({ page }) => {
  await page.goto("/");
  const positions = await page.evaluate(() => {
    const main = document.querySelector("main");
    const brand = document.querySelector(".brand");
    const footer = document.querySelector("footer > span");
    if (!main || !brand || !footer) throw new Error("Missing shell landmarks");
    return {
      content:
        main.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(main).paddingLeft),
      brand: brand.getBoundingClientRect().left,
      footer: footer.getBoundingClientRect().left,
    };
  });
  expect(Math.abs(positions.content - positions.brand)).toBeLessThanOrEqual(2);
  expect(Math.abs(positions.content - positions.footer)).toBeLessThanOrEqual(2);
});

test("workspace and document surfaces remain aligned with synthetic API data", async ({
  page,
}, testInfo) => {
  const { manual, source } = await import("./design-data");
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") throw new Error("Visual audit must not mutate data");
    const values: Record<string, unknown> = {
      "/api/manuals": [manual],
      "/api/sources": [source],
      [`/api/manuals/${manual.id}`]: manual,
      [`/api/sources/${source.id}`]: source,
      [`/api/manuals/${manual.id}/versions`]: [manual.published],
      "/api/shares": [],
      "/api/me": { name: "합성 사용자", email: "synthetic@example.com" },
      "/api/session":
        request.headers()["x-ghost-role"] === "reader"
          ? { role: "reader", manualId: manual.id, expiresAt: "2026-10-25T00:00:00Z" }
          : { role: "owner" },
    };
    if (!(path in values)) throw new Error(`Unexpected audit request: ${path}`);
    await route.fulfill({ json: values[path] });
  });
  for (const [name, path, heading] of [
    ["library", "/manuals", "업무 문서함"],
    ["manual", `/manuals/${manual.id}`, manual.draft.title],
    ["editor", `/manuals/${manual.id}/edit`, "매뉴얼 수정"],
    ["source", `/sources/${source.id}`, source.title],
    ["reader", "/share", manual.draft.title],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (name === "manual" || name === "reader") {
      await expect(page.locator(".document ol li").first()).toHaveCSS("display", "list-item");
    }
    const split = page.locator(".split");
    if (await split.count()) {
      const widths = await split.evaluate((element) =>
        [...element.children].map((child) => child.getBoundingClientRect().width),
      );
      if (widths[0] === undefined || widths[1] === undefined)
        throw new Error("Expected two columns");
      expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(2);
    }
    const screenshot = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`${name}-${testInfo.project.name}`, {
      path: screenshot,
      contentType: "image/png",
    });
  }
});

test("public entry and form screens are visually captured", async ({ page }, testInfo) => {
  for (const [name, path] of [
    ["home", "/"],
    ["login", "/login"],
    ["signup", "/signup"],
    ["register", "/sources/new"],
    ["ask", "/ask"],
    ["terms", "/terms"],
    ["privacy", "/privacy"],
  ] as const) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const screenshot = testInfo.outputPath(`${name}-${testInfo.project.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`${name}-${testInfo.project.name}`, {
      path: screenshot,
      contentType: "image/png",
    });
  }
});

test("starting is visible without scrolling", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("link", { name: "시작하기", exact: true })).toBeInViewport({
    ratio: 1,
  });
});

test("form placeholder remains readable against its input background", async ({ page }) => {
  await page.goto("/sources/new");
  const colors = await page.getByLabel("자료 제목").evaluate((input) => ({
    text: getComputedStyle(input, "::placeholder").color,
    background: getComputedStyle(input).backgroundColor,
  }));
  function luminance(color: string) {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (channels?.length !== 3) throw new Error("Expected opaque RGB color");
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const [red = 0, green = 0, blue = 0] = linear;
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  const text = luminance(colors.text);
  const background = luminance(colors.background);
  expect(
    (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
});

test("home lists available and upcoming features in text", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const features = page.getByRole("list", { name: "GhostManual 기능" }).getByRole("listitem");
  await expect(features).toHaveCount(6);
  await expect(features.filter({ hasText: "사용 가능" })).toHaveCount(5);
  await expect(
    features.filter({
      has: page.getByRole("heading", { level: 3, name: "파일 버전 기록·변경 질문" }),
    }),
  ).toContainText("준비 중");
  await expect(page.getByText("예시 · 준비 중 기능")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const path of ["/login", "/signup"]) {
  test(`Google sign-in leads the form at full width: ${path}`, async ({ page }) => {
    await page.goto(path);
    const google = page.getByRole("link", { name: "Google 계정으로 계속하기", exact: true });
    await expect(google).toBeVisible();
    await expect(google.locator("svg")).toHaveCount(1);
    const [button, form] = await Promise.all([
      google.boundingBox(),
      page.locator("main form").boundingBox(),
    ]);
    if (!button || !form) throw new Error("Missing Google button or form");
    expect(button.y + button.height).toBeLessThanOrEqual(form.y);
    expect(button.width).toBeGreaterThanOrEqual(form.width - 2);
    expect(button.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(/^또는 이메일로 (로그인|가입)$/)).toBeVisible();
  });
}
