import { expect, type Page, type Route, test } from "@playwright/test";
import { extractDocument } from "../../src/lib/document-extractor.ts";
import { claimDocumentJob, completeDocumentJob } from "../../src/lib/document-jobs.ts";
import { docx, pack, wp } from "../fixtures/documents/native/build.ts";
import { signUpAndVerify } from "./helpers";

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function complete(revisionId: string) {
  const job = await claimDocumentJob();
  if (!job) throw new Error("Expected synthetic queued document");
  expect(job.revisionId).toBe(revisionId);
  const result = await extractDocument(job.format, job.bytes);
  expect(result.status).toBe("ready");
  expect(await completeDocumentJob(job, result)).toBe(true);
}
async function twoVersions(page: Page) {
  await signUpAndVerify(page);
  const file = (text: string) => ({
    name: "race.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(pack(docx(wp(text)))),
  });
  const headers = { Origin: "http://localhost:3200" };
  const first = await page.request.post("/api/sources", {
    headers,
    multipart: { title: "버전 경합 합성 자료", file: file("FIRST_RACE_BODY") },
  });
  expect(first.status()).toBe(202);
  const v1 = (await first.json()) as { id: string; revisionId: string };
  await complete(v1.revisionId);
  const second = await page.request.post("/api/sources/" + v1.id + "/revisions", {
    headers,
    multipart: { expectedRevision: "1", file: file("SECOND_RACE_BODY") },
  });
  expect(second.status()).toBe(202);
  const v2 = (await second.json()) as { revisionId: string };
  return { id: v1.id, revisionId: v2.revisionId };
}
async function pending(page: Page, id: string) {
  await page.goto("/sources/" + id);
  await expect(page.getByRole("heading", { name: "버전 2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeDisabled();
}
async function selectedFirst(page: Page) {
  await expect(page.getByRole("heading", { name: "버전 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible();
  await expect(page.getByRole("link", { name: "v2 원본 내려받기" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "AI 초안 요청", exact: true })).toBeDisabled();
}
async function hold(
  route: Route,
  waiting: ReturnType<typeof gate>,
  entered: ReturnType<typeof gate>,
  allowAborted = false,
) {
  const response = await route.fetch();
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status ?? body.extraction?.status).toBe("ready");
  entered.release();
  await waiting.promise;
  if (allowAborted && route.request().failure()?.errorText.includes("ERR_ABORTED")) return;
  await route.fulfill({ response });
}
test("late terminal status cannot replace a newly selected historical version", async ({
  page,
}) => {
  const saved = await twoVersions(page);
  const entered = gate(),
    waiting = gate(),
    ready = gate(),
    settled = gate();
  const path = "**/api/sources/" + saved.id + "/revisions/2/status";
  await page.route(path, async (route) => {
    await ready.promise;
    try {
      await hold(route, waiting, entered, true);
    } finally {
      settled.release();
    }
  });
  try {
    await pending(page, saved.id);
    await complete(saved.revisionId);
    ready.release();
    await entered.promise;
    const aborted = page.waitForEvent("requestfailed", {
      predicate: (request) => new URL(request.url()).pathname.endsWith("/revisions/2/status"),
    });
    await page.getByRole("button", { name: /^v1/ }).click();
    await selectedFirst(page);
    expect((await aborted).failure()?.errorText).toContain("ERR_ABORTED");
    waiting.release();
    await settled.promise;
    await selectedFirst(page);
    await page.unroute(path);
    await page.getByRole("button", { name: /^v2/ }).click();
    await expect(page.getByRole("link", { name: "v2 원본 내려받기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeEnabled();
  } finally {
    ready.release();
    waiting.release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
test("detail completes while another version selection is pending", async ({ page }) => {
  const saved = await twoVersions(page);
  const oldEntered = gate(),
    oldWaiting = gate(),
    firstEntered = gate(),
    firstWaiting = gate();
  const path = "**/api/sources/" + saved.id + "/revisions/";
  await page.route(path + "2", (route) => hold(route, oldWaiting, oldEntered));
  await page.route(path + "1", (route) => hold(route, firstWaiting, firstEntered));
  try {
    await pending(page, saved.id);
    await complete(saved.revisionId);
    await oldEntered.promise;
    await page.getByRole("button", { name: /^v1/ }).click();
    await firstEntered.promise;
    const delivered = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/revisions/2"),
    );
    oldWaiting.release();
    const response = await delivered;
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(page.getByRole("heading", { name: "버전 2", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: "v2 원본 내려받기" })).toHaveCount(0);
    firstWaiting.release();
    await selectedFirst(page);
    await page.unrouteAll({ behavior: "wait" });
    await page.getByRole("button", { name: /^v2/ }).click();
    await expect(page.getByRole("link", { name: "v2 원본 내려받기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "직접 작성하기", exact: true })).toBeEnabled();
  } finally {
    oldWaiting.release();
    firstWaiting.release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
