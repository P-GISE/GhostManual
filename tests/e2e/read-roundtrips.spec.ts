import { expect, test } from "@playwright/test";
import { runDocumentJob } from "../../src/lib/document-jobs.ts";
import { readDocument } from "../../src/lib/documents/read.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { signUpAndVerify } from "./helpers";

test("registration shares current-workspace metadata once per route", async ({ page }) => {
  await signUpAndVerify(page);
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/workspaces") requests++;
  });
  await page.goto("/sources/new");
  await expect(page.getByLabel("자료 제목", { exact: true })).toBeVisible();
  await expect(page.locator(".crumb")).toBeVisible();
  expect(requests).toBe(1);
});

test("initial file read bundles history and latest detail without a second detail GET", async ({
  page,
}) => {
  await signUpAndVerify(page);
  const created = await page.request.post("/api/sources", {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      title: "합성 왕복 검증",
      file: {
        name: "roundtrip.docx",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(pack(docx(wp("ROUNDTRIP_NATIVE_MARKER")))),
      },
    },
  });
  expect(created.status()).toBe(202);
  const source = (await created.json()) as { id: string };
  expect(await runDocumentJob(async (format, bytes) => readDocument(format, bytes))).toBe(true);
  const response = await page.request.get(`/api/sources/${source.id}/revisions?includeLatest=1`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    revisions: [{ revision: 1 }],
    latest: { revision: 1, extraction: { status: "ready" }, preview: [] },
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(new URL(request.url()).pathname + new URL(request.url()).search);
  });
  await page.goto(`/sources/${source.id}`);
  await expect(
    page.getByRole("heading", { name: "추출 내용·문서 변경 보기", exact: true }),
  ).toBeVisible();
  await page.getByText(/^현재 추출 내용 [0-9]+개$/).click();
  await expect(page.getByText("ROUNDTRIP_NATIVE_MARKER", { exact: true })).toBeVisible();
  expect(requests.filter((url) => url === "/api/workspaces")).toHaveLength(1);
  expect(
    requests.filter((url) => url === `/api/sources/${source.id}/revisions?includeLatest=1`),
  ).toHaveLength(1);
  expect(requests.filter((url) => url === `/api/sources/${source.id}/revisions/1`)).toHaveLength(0);
});

test("leaving and returning ignores the old route's delayed workspace response", async ({ page }) => {
  await signUpAndVerify(page);
  const entries = await (await page.request.get("/api/workspaces")).json();
  const current = entries.find((entry: { current: boolean }) => entry.current) as { id: string };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/workspaces", async (route) => {
    const first = ++calls === 1;
    if (first) await held;
    await route.fulfill({
      json: [
        {
          id: current.id,
          name: first ? "OLD_ROUTE_METADATA" : "FRESH_ROUTE_METADATA",
          role: "admin",
          current: true,
        },
      ],
    });
  });
  try {
    await page.goto("/sources/new");
    await expect(page.getByText("문서함을 확인하고 있습니다.", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.dataset["roundtripDocument"] = "same";
    });
    await page.getByRole("link", { name: "도움말", exact: true }).click();
    await expect(page).toHaveURL(/\/help$/);
    release();
    await page.goBack();
    await expect(page.getByLabel("자료 제목", { exact: true })).toBeVisible();
    await expect(page.locator(".crumb")).toContainText("FRESH_ROUTE_METADATA");
    await expect(page.locator(".crumb")).not.toContainText("OLD_ROUTE_METADATA");
    await expect(page.locator("html")).toHaveAttribute("data-roundtrip-document", "same");
  } finally {
    release();
  }
});
