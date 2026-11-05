import { expect, test } from "@playwright/test";

for (const failEvents of [false, true]) {
  test(`admin controls preserve focus, hit area, and save state (event failure: ${failEvents})`, async ({
    page,
  }) => {
    const self = {
      id: "10000000-0000-4000-8000-000000000001",
      name: "GhostManual 관리자",
      email: "admin@example.com",
      department: null,
      createdAt: "2026-11-05T00:00:00.000Z",
      admin: true,
      adminSource: "db",
      self: true,
      aiAllowed: true,
      sources: 0,
      manuals: 0,
      published: 0,
      usage: { bytes: 0, limitBytes: 104857600 },
      customLimit: false,
      aiToday: 0,
    };
    const target = {
      ...self,
      id: "10000000-0000-4000-8000-000000000002",
      name: "대상",
      email: "target@example.com",
      admin: false,
      adminSource: null,
      self: false,
    };
    let saved = false;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/admin/users/" + target.id && route.request().method() === "PATCH") {
        target.aiAllowed = false;
        saved = true;
        await route.fulfill({ json: target });
        return;
      }
      if (route.request().method() !== "GET") throw new Error("Unexpected write");
      if (path === "/api/admin/events" && saved && failEvents) {
        await route.fulfill({ status: 503, json: { error: { message: "synthetic unavailable" } } });
        return;
      }
      const values: Record<string, unknown> = {
        "/api/me": { name: self.name, admin: true },
        "/api/admin/users": [self, target],
        "/api/admin/usage": { days: [{ day: "2026-11-05", total: 0 }], dailyLimit: 100 },
        "/api/admin/events": [],
      };
      if (!(path in values)) throw new Error("Unexpected route");
      await route.fulfill({ json: values[path] });
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "사용자와 사용량" })).toBeVisible();
    await expect(page.getByText("내 관리자 계정", { exact: true })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: target.email });
    const toggle = row.getByLabel("대상 AI 허용");
    const bounds = await toggle.locator("..").boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    await toggle.click();
    const confirmation = page.getByRole("region", { name: "권한 변경 확인" });
    const cancel = confirmation.getByRole("button", { name: "취소" });
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(toggle).toBeFocused();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await confirmation.getByRole("button", { name: "AI 차단", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("권한을 바꿨습니다");
    await expect(row.getByLabel("대상 AI 차단됨")).toBeVisible();
    await expect(row.getByLabel("대상 AI 차단됨")).not.toBeChecked();
    await expect(row.getByLabel("대상 AI 차단됨")).toBeFocused();
    if (failEvents)
      await expect(page.getByRole("main").getByRole("alert")).toContainText("권한은 저장됐지만");
    const overflow = await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
      outside: [...document.querySelectorAll("body *")]
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        }))
        .filter((element) => element.right > innerWidth + 1)
        .slice(0, 12),
    }));
    expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
  });
}
