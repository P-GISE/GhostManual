import { expect, test } from "@playwright/test";
import { manual, source } from "./design-data";

for (const role of ["member", "admin"] as const) {
  for (const created of [false, true]) {
    test(`team hub permissions and keyboard tabs (role: ${role}, created: ${created})`, async ({
      page,
    }, testInfo) => {
      const teamId = "20000000-0000-4000-8000-000000000001";
      const userId = "20000000-0000-4000-8000-000000000002";
      const name = "합성 업무 인수인계 팀";
      const values: Record<string, unknown> = {
        "/api/me": { id: userId, name: "합성 팀원", admin: false },
        "/api/workspaces": [{ id: teamId, name, role, current: true }],
        [`/api/workspaces/${teamId}/members`]: {
          id: teamId,
          name,
          role,
          members: [{ id: userId, name: "합성 팀원", department: null, role }],
          invites: [],
        },
        "/api/manuals": [manual],
        "/api/sources": [{ ...source, canDelete: role === "admin" }],
        [`/api/workspaces/${teamId}/progress`]: {
          total: 1,
          nextCursor: null,
          works: [
            {
              id: source.id,
              title: "합성 진행 업무",
              manualTitle: null,
              createdByName: "합성 팀원",
              revision: 1,
              revisionAt: "2026-11-25T00:00:00.000Z",
              openQuestions: 0,
              manualId: null,
              publishedVersion: null,
              needsReview: false,
              unpublishedChanges: false,
            },
          ],
        },
        "/api/templates": [
          {
            id: "20000000-0000-4000-8000-000000000003",
            name: "합성 인수인계 양식",
            status: "ready",
            itemCount: 3,
            isDefault: true,
          },
        ],
      };
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== "GET") throw new Error("Team accessibility audit must not write");
        if (!(path in values)) throw new Error(`Unexpected team audit request: ${path}`);
        await route.fulfill({ json: values[path] });
      });
      await page.goto(`/teams/${teamId}${created ? "?created=1" : ""}`);
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      const invite = page.getByLabel("초대할 사람의 이메일");
      const notice = page.getByText(`${name} 문서함을 만들었습니다.`, { exact: true });
      const noOverflow = async () => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      };
      if (role === "admin" && created) {
        await expect(notice).toBeVisible();
        await expect(invite).toBeVisible();
        await expect(page.getByRole("button", { name: "초대 메일 보내기" })).toBeDisabled();
        await invite.fill("synthetic@example.com");
        await expect(page.getByRole("button", { name: "초대 메일 보내기" })).toBeEnabled();
        await noOverflow();
        await page.getByRole("button", { name: "팀 화면 보기" }).click();
      } else {
        await expect(invite).toHaveCount(0);
        await expect(notice).toHaveCount(0);
      }

      const tabs = page.getByRole("tablist", { name: `${name} 메뉴` });
      const labels = [
        "업무",
        "팀원·초대",
        "양식",
        ...(role === "admin" ? ["진행 현황"] : []),
        "팀 설정",
      ];
      const ids = [
        "works",
        "members",
        "forms",
        ...(role === "admin" ? ["progress"] : []),
        "settings",
      ];
      await expect(tabs.getByRole("tab")).toHaveCount(labels.length);
      if (role === "member")
        await expect(tabs.getByRole("tab", { name: "진행 현황", exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("tabpanel").getByRole("link", { name: manual.draft.title, exact: true }),
      ).toBeVisible();
      await tabs.getByRole("tab", { name: "업무", exact: true }).focus();
      for (const [index, label] of labels.entries()) {
        const tab = tabs.getByRole("tab", { name: label, exact: true });
        await expect(tab).toBeFocused();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(tab).toHaveAttribute("tabindex", "0");
        await expect(tab).toHaveAttribute("aria-controls", `panel-${ids[index]}`);
        await expect(tabs.locator('[aria-selected="false"]')).toHaveCount(labels.length - 1);
        for (const inactive of await tabs.locator('[aria-selected="false"]').all()) {
          await expect(inactive).toHaveAttribute("tabindex", "-1");
        }
        const panel = page.getByRole("tabpanel");
        await expect(panel).toHaveAttribute("id", `panel-${ids[index]}`);
        await expect(panel).toHaveAttribute("aria-labelledby", `tab-${ids[index]}`);
        await expect(panel).toHaveAccessibleName(label);
        const bounds = await tab.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        if (index === 1) {
          await expect(panel.getByRole("heading", { name: "팀원 1명" })).toBeVisible();
          if (role === "admin") await expect(invite).toBeVisible();
          else await expect(invite).toHaveCount(0);
        }
        if (index === 2) {
          await expect(panel.getByRole("link", { name: "합성 인수인계 양식" })).toBeVisible();
          await expect(panel.getByRole("button", { name: "양식 등록" })).toBeDisabled();
        }
        if (ids[index] === "progress") {
          await expect(
            panel.getByRole("heading", { name: "진행 현황", exact: true }),
          ).toBeVisible();
          await expect(panel.getByRole("row", { name: /합성 진행 업무/ })).toBeVisible();
          await expect(panel.getByRole("listitem").filter({ hasText: "초안" })).toContainText(
            "진행 중",
          );
        }
        if (ids[index] === "settings") {
          await expect(panel.getByRole("button", { name: "팀 나가기" })).toBeEnabled();
          if (role === "admin") {
            await expect(page.getByLabel("팀 이름 바꾸기")).toBeVisible();
            const remove = panel.getByRole("button", { name: "이 팀 문서함 삭제" });
            await expect(remove).toBeDisabled();
            await page.getByLabel("삭제할 팀 이름").fill(name);
            await expect(remove).toBeEnabled();
            await tab.focus();
          } else {
            await expect(page.getByLabel("팀 이름 바꾸기")).toHaveCount(0);
            await expect(panel.getByRole("button", { name: "이 팀 문서함 삭제" })).toHaveCount(0);
          }
        }
        await noOverflow();
        await tab.press("ArrowRight");
      }
      const works = tabs.getByRole("tab", { name: "업무", exact: true });
      await expect(works).toBeFocused();
      await expect(works).toHaveAttribute("aria-selected", "true");
      await works.press("ArrowLeft");
      await expect(tabs.getByRole("tab", { name: "팀 설정" })).toBeFocused();
      await expect(page).toHaveURL(/\?tab=settings$/);
      await page.screenshot({ path: testInfo.outputPath("team-hub.png"), fullPage: true });
    });
  }
}
