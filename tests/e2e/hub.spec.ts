import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./helpers";

test("my library shows every team's work and opens it in the right team", async ({ page }) => {
  await signUpAndVerify(page, undefined, "허브 담당자");
  await page.getByRole("link", { name: "내 문서함", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 문서함", level: 1 })).toBeVisible();
  // 팀도 개인 업무도 없으면 팀 만들기부터 안내한다.
  await expect(page.getByRole("heading", { name: "팀 문서함을 만들어 시작하세요" })).toBeVisible();
  await page.getByRole("link", { name: "팀 만들기" }).click();
  await page.getByLabel("팀 이름").fill("허브 팀");
  await page.getByRole("button", { name: "팀 문서함 만들기" }).click();
  await page.getByRole("link", { name: "새 업무 등록" }).click();
  await page.getByLabel("자료 제목").fill("허브에서 볼 업무");
  await page
    .getByLabel("업무 내용", { exact: true })
    .fill("승인을 확인한 뒤 계정을 발급하고 결과를 기록합니다. ".repeat(10));
  await page.getByRole("button", { name: "원본 등록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "허브에서 볼 업무" })).toBeVisible();
  const sourceUrl = page.url();

  // 세션을 개인 문서함으로 돌려 놓아도 내 문서함에는 팀의 업무가 보인다.
  await page.getByLabel("문서함 전환").selectOption({ label: "내 문서함" });
  await expect(page.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
  await expect(page.getByText("허브에서 볼 업무")).toHaveCount(0);
  await page.goto("/library");
  const team = page.getByRole("region", { name: "허브 팀" });
  await expect(team.getByText("팀원 1명 · 업무 1개", { exact: true })).toBeVisible();
  await expect(team.getByRole("link", { name: "허브에서 볼 업무" })).toBeVisible();
  await expect(team.getByText("올린 사람 허브 담당자", { exact: true })).toBeVisible();
  await expect(team.getByText("매뉴얼 없음", { exact: true })).toBeVisible();
  await expect(team.getByRole("link", { name: "허브 팀 팀원 초대" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 찾기와 거르기는 모든 팀에 한 번에 적용된다.
  await page.getByLabel("업무 검색").fill("없는 이름");
  await expect(
    page.getByText("조건에 맞는 업무가 없습니다.", { exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel("업무 검색").fill("허브에서");
  await page.getByRole("button", { name: "게시됨 0" }).click();
  await expect(
    page.getByText("조건에 맞는 업무가 없습니다.", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "내가 할 일 1" }).click();

  // 다른 문서함을 보고 있었어도 업무를 누르면 그 팀으로 전환해 연다.
  await team.getByRole("link", { name: "허브에서 볼 업무" }).click();
  await expect(page).toHaveURL(sourceUrl);
  await expect(page.getByRole("heading", { name: "허브에서 볼 업무" })).toBeVisible();
  await expect(page.getByLabel("문서함 전환").locator("option:checked")).toHaveText("허브 팀");
});
