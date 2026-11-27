import { expect, test, type Page } from "@playwright/test";
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
      file: { name: "progress.docx", mimeType: "application/octet-stream",
        buffer: Buffer.from(pack(docx(wp("완료 확인 합성 본문")))) },
    },
  });
  expect(response.status()).toBe(202);
  const saved = await response.json() as { id: string; revisionId: string };
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
test.afterAll(async () => { await pool.end(); });
test("status endpoint returns only scoped revision identity and state", async ({ page }) => {
  const saved = await pending(page);
  const response = await page.request.get("/api/sources/" + saved.id + "/revisions/1/status");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ revisionId: saved.revisionId, status: "queued" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});
test("completed native document is visible within 1200ms", async ({ page }) => {
  await pending(page);
  await complete();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible({ timeout: 1200 });
});
