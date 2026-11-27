import { expect, test } from "@playwright/test";
import { z } from "zod";
import { signUpAndVerify } from "./helpers";

for (const unavailable of [false, true]) {
  test(`team rename refreshes client-navigation breadcrumb (unavailable: ${unavailable})`, async ({
    page,
  }) => {
    await signUpAndVerify(page);
    const origin = new URL(page.url()).origin;
    const response = await page.request.get("/api/workspaces");
    expect(response.status()).toBe(200);
    const teams = z
      .array(z.object({ id: z.uuid(), name: z.string().nullable(), current: z.boolean() }))
      .parse(await response.json());
    const team = teams.find((entry) => entry.current && entry.name !== null);
    if (!team || team.name === null) throw new Error("Missing isolated current team");
    const octet = () => Math.floor(Math.random() * 250) + 1;
    const created = await page.request.post("/api/sources", {
      headers: {
        Origin: origin,
        "CF-Connecting-IP": `10.${octet()}.${octet()}.${octet()}`,
      },
      data: {
        title: "합성 경로 갱신 업무",
        text: "업무 담당자는 승인을 확인하고 처리 결과를 기록합니다. ".repeat(10),
      },
    });
    expect(created.status()).toBe(201);
    const source = z.object({ id: z.uuid() }).parse(await created.json());
    await page.goto(`/sources/${source.id}`);
    await expect(
      page.getByRole("heading", { name: "합성 경로 갱신 업무", exact: true }),
    ).toBeVisible();
    const crumb = page.locator(".crumb");
    await expect(crumb.getByRole("link", { name: team.name, exact: true })).toBeVisible();
    const marker = crypto.randomUUID();
    await page.evaluate((value) => {
      document.documentElement.dataset["crumbDocument"] = value;
    }, marker);
    await crumb.getByRole("link", { name: team.name, exact: true }).click();
    await expect(page).toHaveURL(`${origin}/teams/${team.id}`);
    await expect(page.getByRole("heading", { name: "업무", level: 2, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-crumb-document", marker);
    await page.getByRole("tab", { name: "팀 설정", exact: true }).click();
    const renamed = "갱신된 합성 팀";
    await page.getByLabel("팀 이름 바꾸기", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "이름 저장", exact: true }).click();
    await expect(page.getByRole("heading", { name: renamed, level: 1, exact: true })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "팀 이름을 바꿨습니다." }),
    ).toBeVisible();
    if (unavailable)
      await page.route("**/api/workspaces", (route) =>
        route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "합성 조회 실패", retryable: false } },
        }),
      );
    await page.getByRole("tab", { name: "업무", exact: true }).click();
    await page.getByRole("link", { name: "새 업무 등록", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/sources/new`);
    if (unavailable) {
      await expect(
        page
          .getByRole("main")
          .getByRole("alert")
          .filter({ hasText: "문서함을 확인하지 못했습니다." }),
      ).toBeVisible();
      await expect(crumb).toHaveCount(0);
      await expect(page.getByLabel("자료 제목", { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByLabel("자료 제목", { exact: true })).toBeVisible();
      await expect(crumb.getByRole("link", { name: renamed, exact: true })).toHaveAttribute(
        "href",
        `/teams/${team.id}`,
      );
      await expect(crumb.getByRole("link", { name: team.name, exact: true })).toHaveCount(0);
    }
    await expect(page.locator("html")).toHaveAttribute("data-crumb-document", marker);
  });
}
