import { expect, test } from "@playwright/test";

test("login: the SSR button cannot lose a click before hydration", async ({ page, context }) => {
  let resumeScripts = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    resumeScripts = resolve;
  });
  let heldScripts = 0;
  let logins = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/login") logins++;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    heldScripts++;
    await scriptsReady;
    await route.continue().catch(() => {});
  });
  const offset = (await (await context.request.get("/__fixture/observations")).json()).length;
  try {
    await page.goto("/login", { waitUntil: "commit" });
    const button = page.getByRole("button", { name: "로그인", exact: true });
    await expect(button).toBeVisible();
    await expect.poll(() => heldScripts).toBeGreaterThan(0);
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("SSR button geometry missing");
    // A real early pointer click while every Next JavaScript response is still held.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const observations = (
      await (await context.request.get("/__fixture/observations")).json()
    ).slice(offset);
    expect(observations.some((entry: { path: string }) => entry.path === "/api/auth/login")).toBe(
      false,
    );
    expect(logins).toBe(0);
    await expect(
      button,
      "SSR must not present an enabled action before its handler exists",
    ).toBeDisabled();
    resumeScripts();
    await expect(button).toBeEnabled();
    await page.getByLabel("이메일").fill("a@example.com");
    await page.getByLabel("비밀번호", { exact: true }).fill("correct horse 9");
    await button.click();
    await expect(page).toHaveURL(/\/manuals$/);
    await expect(page.getByText("아직 매뉴얼이 없습니다.")).toBeVisible();
    expect(logins).toBe(1);
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.name === "gm_owner" && cookie.secure && cookie.httpOnly,
      ),
    ).toBe(true);
  } finally {
    resumeScripts();
  }
});
