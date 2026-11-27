import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { signUpAndVerify } from "./helpers";

async function joinTeam(host: Page, guest: Page, teamId: string, headers: Record<string, string>) {
  const { email } = await (await guest.request.get("/api/me")).json();
  const invitation = await host.request.post(`/api/workspaces/${teamId}/invites`, {
    headers,
    data: { email },
  });
  expect(invitation.status()).toBe(201);
  const dir = process.env["E2E_MAIL_DIR"] ?? "";
  const file = readdirSync(dir)
    .filter((name) => name.endsWith(`-${email}.txt`))
    .sort()
    .at(-1);
  const url = file
    ? readFileSync(join(dir, file), "utf8").match(/https?:\/\/\S+\/invite#\S+/)?.[0]
    : undefined;
  if (!url) throw new Error("Missing isolated team invitation");
  await guest.goto(url);
  await expect(guest).toHaveURL(`${new URL(url).origin}/teams/${teamId}`);
  await expect
    .poll(async () => {
      const response = await guest.request.get("/api/workspaces");
      expect(response.status()).toBe(200);
      const list = z
        .array(z.object({ id: z.uuid(), current: z.boolean() }))
        .parse(await response.json());
      return list.find((workspace) => workspace.current)?.id;
    })
    .toBe(teamId);
  // The invitation cookie can arrive before TeamPage finishes its own alignment/reload.
  // Wait for the aligned work panel before API setup changes the shared cookie again.
  await expect(guest.getByRole("heading", { name: "업무", level: 2, exact: true })).toBeVisible();
}

test("another team's session can find both lead teams, explicitly transfer and then delete without losing team content", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await signUpAndVerify(page, undefined, "탈퇴 안내 담당자", false);
  const origin = new URL(page.url()).origin;
  // Page-only visitor headers do not isolate APIRequestContext mail limits.
  const octet = () => Math.floor(Math.random() * 250) + 1;
  const headers = { Origin: origin, "CF-Connecting-IP": `10.${octet()}.${octet()}.${octet()}` };
  const create = async (who: Page, name: string) => {
    const result = await who.request.post("/api/workspaces", { headers, data: { name } });
    expect(result.status()).toBe(201);
    return (await result.json()).id as string;
  };
  const first = await create(page, "합성 대표 팀 A");
  const second = await create(page, "합성 대표 팀 B");
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const successor = await context.newPage();
    await signUpAndVerify(successor, undefined, "이양 후임 담당자", false);
    const selected = await create(successor, "합성 참여 팀 C");
    await joinTeam(page, successor, first, headers);
    await joinTeam(page, successor, second, headers);
    await joinTeam(successor, page, selected, headers);
    expect(
      (
        await page.request.post("/api/session/workspace", { headers, data: { workspaceId: first } })
      ).status(),
    ).toBe(200);
    const seeded = await page.request.post("/api/workspace/example", { headers });
    expect(seeded.status()).toBe(201);
    const manual = await seeded.json();
    expect(
      (
        await page.request.post(`/api/manuals/${manual.id}/publish`, {
          headers,
          data: { expectedRevision: 1, acknowledgedUnknowns: manual.draft.unknowns },
        })
      ).status(),
    ).toBe(201);
    const sharing = await page.request.put("/api/shares", {
      headers,
      data: { manualId: manual.id, mode: "link" },
    });
    expect(sharing.status()).toBe(200);
    const token = ((await sharing.json()).url as string).split("#")[1];
    expect(
      (
        await page.request.post("/api/session/workspace", {
          headers,
          data: { workspaceId: selected },
        })
      ).status(),
    ).toBe(200);
    let deletes = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/me" && request.method() === "DELETE") deletes++;
    });
    const settings = async () => {
      await page.goto("/account");
      await expect(page.getByLabel("이름", { exact: true })).toHaveValue("탈퇴 안내 담당자");
      await page.getByRole("tab", { name: "설정", exact: true }).click();
      await page.getByLabel("삭제할 내용을 확인했습니다.").check();
      await page.getByRole("button", { name: "계정과 문서 영구 삭제", exact: true }).click();
    };
    await settings();
    const notice = page.getByRole("region", { name: "대표 권한 이양 안내" });
    await expect(notice.getByRole("link", { name: "합성 대표 팀 A 대표 이양" })).toBeVisible();
    await expect(notice.getByRole("link", { name: "합성 대표 팀 B 대표 이양" })).toBeVisible();
    await expect(notice.getByText("합성 참여 팀 C")).toHaveCount(0);
    expect((await page.request.get("/api/me")).status()).toBe(200);
    expect(deletes).toBe(1);
    await notice.getByRole("link", { name: "합성 대표 팀 A 대표 이양" }).click();
    await expect(page).toHaveURL(`${origin}/teams/${first}?tab=members`);
    await page
      .getByRole("button", { name: "이양 후임 담당자에게 관리자 넘기기", exact: true })
      .click();
    await page.getByRole("button", { name: "넘기기 확인", exact: true }).click();
    await expect(
      page.getByText("이양 후임 담당자 님에게 관리자를 넘겼습니다.", { exact: true }),
    ).toBeVisible();
    await settings();
    await expect(notice.getByRole("link", { name: "합성 대표 팀 A 대표 이양" })).toHaveCount(0);
    await expect(notice.getByRole("link", { name: "합성 대표 팀 B 대표 이양" })).toBeVisible();
    expect(deletes).toBe(2);
    await notice.getByRole("link", { name: "합성 대표 팀 B 대표 이양" }).click();
    await page
      .getByRole("button", { name: "이양 후임 담당자에게 관리자 넘기기", exact: true })
      .click();
    await page.getByRole("button", { name: "넘기기 확인", exact: true }).click();
    await expect(
      page.getByText("이양 후임 담당자 님에게 관리자를 넘겼습니다.", { exact: true }),
    ).toBeVisible();
    await settings();
    await expect(page).toHaveURL(/\/$/);
    expect(deletes).toBe(3);
    await successor.route("**/api/session/workspace", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await successor.goto(`/teams/${first}?tab=members`);
    await expect(
      successor.getByRole("heading", { name: "합성 대표 팀 A", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const response = await successor.request.get("/api/workspaces");
        expect(response.status()).toBe(200);
        const list = z
          .array(z.object({ id: z.uuid(), current: z.boolean() }))
          .parse(await response.json());
        return list.find((workspace) => workspace.current)?.id;
      })
      .toBe(first);
    const preserved = await successor.request.get(`/api/manuals/${manual.id}`);
    expect(preserved.status()).toBe(200);
    expect(await preserved.json()).toMatchObject({ id: manual.id, draft: manual.draft });
    expect(
      (await successor.request.post("/api/share", { headers, data: { token } })).status(),
    ).toBe(200);
  } finally {
    await context.close();
  }
});
