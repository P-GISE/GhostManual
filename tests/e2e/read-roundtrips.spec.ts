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
  const response = await page.request.get(
    `/api/sources/${source.id}/revisions?includeLatest=1`,
  );
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
  expect(requests.filter((url) => url === `/api/sources/${source.id}/revisions?includeLatest=1`))
    .toHaveLength(1);
  expect(requests.filter((url) => url === `/api/sources/${source.id}/revisions/1`))
    .toHaveLength(0);
});
