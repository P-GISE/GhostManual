import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, expect, type Page } from "@playwright/test";

const e2eMailDir = process.env["E2E_MAIL_DIR"] ?? "";

export const password = "correct horse 9";
export function uniqueEmail() {
  return `e2e-${crypto.randomUUID()}@example.com`;
}
// Each signup looks like a new visitor so per-IP signup limits do not span tests.
export async function asNewVisitor(page: Page) {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  await page.setExtraHTTPHeaders({ "CF-Connecting-IP": `10.${octet()}.${octet()}.${octet()}` });
}
export async function resetLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(() => {
      const name = readdirSync(e2eMailDir)
        .filter((file) => file.endsWith(`-${email}.txt`))
        .sort()
        .at(-1);
      link = name
        ? readFileSync(join(e2eMailDir, name), "utf8").match(
            /https?:\/\/\S+\/reset-password#\S+/,
          )?.[0]
        : undefined;
      return Boolean(link);
    })
    .toBe(true);
  return link ?? "";
}
export async function verificationLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(() => {
      const name = readdirSync(e2eMailDir)
        .filter((file) => file.endsWith(`-${email}.txt`))
        .sort()
        .at(-1);
      link = name
        ? readFileSync(join(e2eMailDir, name), "utf8").match(
            /https?:\/\/\S+\/api\/auth\/verify\?token=\S+/,
          )?.[0]
        : undefined;
      return Boolean(link);
    })
    .toBe(true);
  return link ?? "";
}
export async function signUp(page: Page, email = uniqueEmail(), name = "테스트 사용자") {
  await asNewVisitor(page);
  await page.goto("/signup");
  // Typing before hydration is reset by React, so wait until the form is live.
  await expect(page.getByRole("button", { name: "가입하기" })).toBeEnabled();
  await page.getByLabel("이름").fill(name);
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page.getByLabel("이용약관과 개인정보 안내에 동의합니다.").check();
  await page.getByRole("button", { name: "가입하기" }).click();
  await expect(page.getByText("인증 메일을 보냈습니다.")).toBeVisible();
  return email;
}
export async function signUpAndVerify(page: Page, email = uniqueEmail(), name = "테스트 사용자") {
  await signUp(page, email, name);
  await page.goto(await verificationLink(email));
  // Signing in lands on the landing page; the tests continue from the library.
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/manuals");
  await expect(page.getByRole("heading", { name: "업무 문서함", level: 1 })).toBeVisible();
  return email;
}
export async function loadExample(page: Page) {
  await page.getByRole("button", { name: "예제 불러오기" }).click();
  await expect(
    page.getByRole("link", { name: "신입 구성원 업무 계정 발급" }).first(),
  ).toBeVisible();
}
export async function logIn(page: Page, email: string) {
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeEnabled();
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}
export async function turnOnLinkSharing(page: Page) {
  await page.getByLabel("링크가 있는 사용자 볼 수 있음").check();
  await expect(page.getByLabel("읽기 전용 링크")).toBeVisible();
  return page.getByLabel("읽기 전용 링크").inputValue();
}
// A separate signed-in account opens the shared link, as a successor would.
export async function openAsNewReader(
  browser: Browser,
  url: string,
  viewport: ReturnType<Page["viewportSize"]>,
) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signUpAndVerify(page, undefined, "후임자");
  await page.goto(url);
  return { context, page };
}
