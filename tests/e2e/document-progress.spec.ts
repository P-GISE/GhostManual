import { expect, type Page, test } from "@playwright/test";
import { pool } from "../../src/lib/db.ts";
import { extractDocument } from "../../src/lib/document-extractor.ts";
import { claimDocumentJob, completeDocumentJob } from "../../src/lib/document-jobs.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { signUpAndVerify } from "./helpers";

async function pending(page: Page) {
  await signUpAndVerify(page);
  const response = await page.request.post("/api/sources", {
    headers: { Origin: "http://localhost:3200" },
    multipart: {
      title: "완료 감지 합성 자료",
      file: {
        name: "progress.docx",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(pack(docx(wp("완료 확인 합성 본문")))),
      },
    },
  });
  expect(response.status()).toBe(202);
  const saved = (await response.json()) as { id: string; revisionId: string };
  const loaded = page.waitForResponse((r) => r.url().includes("/revisions?includeLatest=1"));
  await page.goto("/sources/" + saved.id);
  await loaded;
  await expect(page.getByRole("heading", { name: "버전 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toHaveCount(0);
  return saved;
}
async function complete() {
  const job = await claimDocumentJob();
  if (!job) throw new Error("Expected synthetic queued document");
  const result = await extractDocument(job.format, job.bytes);
  expect(result.status).toBe("ready");
  expect(await completeDocumentJob(job, result)).toBe(true);
}
test.afterAll(async () => {
  await pool.end();
});
test("status endpoint returns only scoped revision identity and state", async ({ page }) => {
  const saved = await pending(page);
  const response = await page.request.get("/api/sources/" + saved.id + "/revisions/1/status");
  await complete();
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ revisionId: saved.revisionId, status: "queued" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});
test("completed native document is visible within 1200ms", async ({ page }) => {
  await pending(page);
  await complete();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible({ timeout: 1200 });
});

test("status failures stop and explicit retry reads the same revision", async ({ page }) => {
  let calls = 0;
  await page.route("**/revisions/1/status", (route) => {
    calls++;
    return route.fulfill({ status: 503, json: { error: { message: "합성 상태 오류" } } });
  });
  const saved = await pending(page);
  await expect(page.getByRole("button", { name: "처리 상태 다시 확인" })).toBeVisible();
  const stopped = calls;
  await page.waitForTimeout(600);
  expect(calls).toBe(stopped);
  expect(calls).toBe(1);
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toHaveCount(0);
  await complete();
  await page.unroute("**/revisions/1/status");
  await page.getByRole("button", { name: "처리 상태 다시 확인" }).click();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible({ timeout: 1500 });
  const revisions = await (
    await page.request.get("/api/sources/" + saved.id + "/revisions")
  ).json();
  expect(revisions).toHaveLength(1);
});
test("terminal metadata never enables a document when authorized detail fails", async ({
  page,
}) => {
  await pending(page);
  await page.route("**/revisions/1", (route) =>
    route.fulfill({ status: 403, json: { error: { message: "권한 변경" } } }),
  );
  await complete();
  await expect(page.getByRole("button", { name: "처리 상태 다시 확인" })).toBeVisible();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeDisabled();
  await page.unroute("**/revisions/1");
  await page.getByRole("button", { name: "처리 상태 다시 확인" }).click();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible({ timeout: 1500 });
});
test("leaving a pending document cancels its status loop", async ({ page }) => {
  const saved = await pending(page);
  let calls = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/status")) calls++;
  });
  await page.getByRole("link", { name: "도움말", exact: true }).click();
  await expect(page).toHaveURL(/\/help$/);
  const stopped = calls;
  await page.waitForTimeout(700);
  expect(calls).toBe(stopped);
  await complete();
  expect(
    (await page.request.get("/api/sources/" + saved.id + "/revisions/1/status")).status(),
  ).toBe(200);
});

test("a mismatched status identity cannot enable the selected document", async ({ page }) => {
  await page.route("**/revisions/1/status", (route) =>
    route.fulfill({
      json: { revisionId: "00000000-0000-4000-8000-000000000001", status: "ready" },
    }),
  );
  await pending(page);
  await expect(page.getByRole("button", { name: "처리 상태 다시 확인" })).toBeVisible();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeDisabled();
  await complete();
});
