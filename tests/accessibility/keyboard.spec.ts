import { expect, test } from "@playwright/test";

for (const path of [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/sources/new",
  "/terms",
  "/privacy",
]) {
  test(`skip link moves keyboard focus into content: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "본문으로 이동", exact: true });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    const main = page.getByRole("main");
    await expect(main).toBeFocused();
    await expect(main).toHaveCSS("outline-style", "solid");
    await expect(main).toHaveCSS("outline-width", "3px");
    // Computed outline CSS alone can pass while every painted edge is offscreen.
    const hasVisibleOutline = await main.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const width = Number.parseFloat(style.outlineWidth);
      const offset = Number.parseFloat(style.outlineOffset);
      const left = bounds.left - offset - width;
      const right = bounds.right + offset + width;
      const top = bounds.top - offset - width;
      const bottom = bounds.bottom + offset + width;
      const edges = [
        { left, right: left + width, top, bottom },
        { left: right - width, right, top, bottom },
        { left, right, top, bottom: top + width },
        { left, right, top: bottom - width, bottom },
      ];
      return edges.some(
        (edge) =>
          edge.right > 0 &&
          edge.left < window.innerWidth &&
          edge.bottom > 0 &&
          edge.top < window.innerHeight,
      );
    });
    expect(hasVisibleOutline).toBe(true);
    await page.keyboard.press("Tab");
    // Skipping the header must not put the next Tab back in the navigation.
    await expect(main.locator(":focus")).toHaveCount(1);
  });
}
