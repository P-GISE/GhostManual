import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

for (const action of ["delete", "leave"] as const) {
  test(`${action} selected team returns to my library without losing the login`, async ({
    page,
    browser,
  }) => {
    await signUpAndVerify(page, undefined, "복귀 담당자", false);
    const origin = new URL(page.url()).origin;
    let teamId: string;
    let otherContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    if (action === "leave") {
      otherContext = await browser.newContext();
      const owner = await otherContext.newPage();
      await signUpAndVerify(owner, undefined, "팀 관리자", false);
      const created = await owner.request.post("/api/workspaces", {
        headers: { Origin: origin },
        data: { name: "복귀 검증 팀" },
      });
      expect(created.status()).toBe(201);
      teamId = (await created.json()).id;
      const me = await (await page.request.get("/api/me")).json();
      const invited = await owner.request.post(`/api/workspaces/${teamId}/invites`, {
        headers: { Origin: origin },
        data: { email: me.email },
      });
      expect(invited.status()).toBe(201);
      // The synthetic file mail is read by the same helper used for verification links.
      const { readdirSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { E2E_MAIL_DIR: dir = "" } = process.env;
      const file = readdirSync(dir)
        .filter((name) => name.endsWith(`-${me.email}.txt`))
        .sort()
        .at(-1);
      const link = file
        ? readFileSync(join(dir, file), "utf8").match(/https?:\/\/\S+\/invite#\S+/)?.[0]
        : undefined;
      if (!link) throw new Error("Missing synthetic invite");
      await page.goto(link);
      await expect(page).toHaveURL(new RegExp(`/teams/${teamId}$`));
      await page.goto(`/teams/${teamId}?tab=settings`);
    } else {
      await page.goto("/library");
      await page.getByLabel("팀 이름", { exact: true }).fill("복귀 검증 팀");
      await page.getByRole("button", { name: "팀 문서함 만들기", exact: true }).click();
      await expect(page.getByRole("button", { name: "팀 화면 보기" })).toBeVisible();
      await page.getByRole("button", { name: "팀 화면 보기" }).click();
      await page.getByRole("tab", { name: "팀 설정", exact: true }).click();
      teamId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    }
    try {
      const before = (await page.context().cookies()).find(
        (cookie) => cookie.name === "gm_owner",
      )?.value;
      if (action === "delete") {
        await page.getByLabel("삭제할 팀 이름").fill("복귀 검증 팀");
        await page.getByRole("button", { name: "이 팀 문서함 삭제", exact: true }).click();
      } else await page.getByRole("button", { name: "팀 나가기", exact: true }).click();
      await expect(page).toHaveURL(/\/library$/);
      await expect(
        page.getByRole("heading", { name: "팀 문서함을 만들어 시작하세요" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
      expect((await page.request.get("/api/me")).status()).toBe(200);
      const after = (await page.context().cookies()).find(
        (cookie) => cookie.name === "gm_owner",
      )?.value;
      expect(Boolean(after) && after !== before).toBe(true);
      const response = await page.request.get(`/api/workspaces/${teamId}/members`);
      expect(response.status()).toBe(404);
    } finally {
      await otherContext?.close();
    }
  });
}
