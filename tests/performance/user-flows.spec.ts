import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { setTimeout } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { pool } from "../../src/lib/db.ts";
import { extractDocument } from "../../src/lib/document-extractor.ts";
import { claimDocumentJob, completeDocumentJob } from "../../src/lib/document-jobs.ts";
import { createTeam, openTeam, signUpAndVerify } from "../e2e/helpers";
import { docx, hwpx, pack, pptx, wp } from "../fixtures/documents/native/build.ts";
import { assertLatencyTarget, percentile } from "./latency-metrics.ts";
import { add, measure, rows } from "./latency-recorder.ts";

const formats = ["docx", "hwpx", "pptx"] as const;
type Format = (typeof formats)[number];
function fixture(format: Format, marker: string) {
  return Buffer.from(
    pack(format === "docx" ? docx(wp(marker)) : format === "hwpx" ? hwpx(marker) : pptx(marker)),
  );
}
test("isolated native upload and read baseline", async ({ page }) => {
  assertLatencyTarget(process.env);
  const usageStart = process.resourceUsage();
  const sizes: Record<string, number[]> = {};
  const checks: Record<string, number> = {};
  let completed = false;
  try {
    await signUpAndVerify(page, undefined, "지연 측정 합성 사용자", false);
    const teams = new Map<Format, string>();
    for (const format of formats) teams.set(format, await createTeam(page, "측정 " + format));
    for (const format of formats) {
      const switched = await page.request.post("/api/session/workspace", {
        headers: { Origin: "http://localhost:3200" },
        data: { workspaceId: teams.get(format) },
      });
      expect(switched.ok()).toBe(true);
      await openTeam(page, teams.get(format) ?? "");
      let lastStarted = 0;
      for (let sample = 0; sample <= 30; sample++) {
        await setTimeout(Math.max(0, 3500 - (performance.now() - lastStarted)));
        lastStarted = performance.now();
        const marker = "LATENCY_" + format.toUpperCase() + "_" + sample;
        const payload = fixture(format, marker);
        sizes[format] ??= [];
        sizes[format].push(payload.length);
        await measure(page, "registration-form", format, sample, async () => {
          await page.goto("/sources/new");
          await expect(page.getByLabel("자료 제목")).toBeVisible();
        });
        const title = "합성 " + format + " " + sample;
        await page.getByLabel("자료 제목").fill(title);
        await page.locator("#source-file").setInputFiles({
          name: "case" + sample + "." + format,
          mimeType: "application/octet-stream",
          buffer: payload,
        });
        let sourceId = "";
        await measure(page, "click-to-accepted", format, sample, async () => {
          const response = page.waitForResponse(
            (value) =>
              value.request().method() === "POST" &&
              new URL(value.url()).pathname === "/api/sources",
          );
          await page.getByRole("button", { name: "원본 등록", exact: true }).click();
          const received = await response;
          expect(received.status()).toBe(202);
          sourceId = (await received.json()).id as string;
        });
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toHaveCount(0);
        const blocked = await page.request.get("/api/sources/" + sourceId + "/revisions/1/file");
        expect(blocked.status()).toBe(409);
        checks["pendingDownloadBlocked"] = (checks["pendingDownloadBlocked"] ?? 0) + 1;
        const claimAt = performance.now();
        const job = await claimDocumentJob();
        if (!job) throw new Error("Expected one queued synthetic document");
        add("claim", format, sample, performance.now() - claimAt);
        const age = await pool.query<{ age: number }>(
          "SELECT extract(epoch FROM(clock_timestamp()-created_at))*1000 AS age FROM document_jobs WHERE id=$1",
          [job.id],
        );
        add("queue-age-observed-after-claim", format, sample, Number(age.rows[0]?.age));
        const parsingAt = performance.now();
        const extracted = await extractDocument(job.format, job.bytes);
        add("native-extract", format, sample, performance.now() - parsingAt);
        expect(extracted.status).toBe("ready");
        expect(extracted.snapshot?.blocks.some((block) => block.text.includes(marker))).toBe(true);
        const completeAt = performance.now();
        expect(await completeDocumentJob(job, extracted)).toBe(true);
        add("complete-store", format, sample, performance.now() - completeAt);
        await measure(page, "stored-to-ui-detected", format, sample, async () => {
          await expect(page.getByRole("link", { name: "v1 원본 내려받기" })).toBeVisible();
        });
        await measure(page, "read-to-content-visible", format, sample, async () => {
          await page.reload();
          await expect(
            page.getByRole("heading", { name: "추출 내용·문서 변경 보기", exact: true }),
          ).toBeVisible();
          await page.getByText(/^현재 추출 내용 [0-9]+개$/).click();
          await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
        });
      }
    }
    for (let sample = 0; sample <= 30; sample++)
      await measure(page, "library-to-cards", "3-teams-93-files", sample, async () => {
        await page.goto("/library");
        await expect(page.locator(".task-card")).toHaveCount(30);
        await expect(page.getByRole("heading", { name: "내 문서함", level: 1 })).toBeVisible();
      });
    const missing = await page.request.get("/api/sources/00000000-0000-4000-8000-000000000000");
    expect(missing.status()).toBe(404);
    checks["missingSource404"] = 1;
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":{"message":"Synthetic unavailable"}}',
      }),
    );
    await page.goto("/sources/new");
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByLabel("자료 제목")).toHaveCount(0);
    checks["unavailableWorkspaceBlocksInput"] = 1;
    await page.unrouteAll();
    expect(
      rows
        .filter((row) => !row.warmup)
        .every((row) => row.api.every((api) => api.status === 200 || api.status === 202)),
    ).toBe(true);
    expect(rows).toHaveLength(775);
    completed = true;
  } finally {
    const groups = [
      ...new Set(rows.filter((row) => !row.warmup).map((row) => row.phase + "/" + row.format)),
    ];
    const summary = groups.map((key) => {
      const samples = rows.filter((row) => !row.warmup && row.phase + "/" + row.format === key);
      return {
        key,
        samples: samples.length,
        p50Ms: percentile(
          samples.map((row) => row.elapsedMs),
          0.5,
        ),
        p95Ms: percentile(
          samples.map((row) => row.elapsedMs),
          0.95,
        ),
        apiResponses: samples.reduce((sum, row) => sum + row.api.length, 0),
        apiStarted: samples.reduce((sum, row) => sum + row.startedRequests, 0),
        unobservedResponses: samples.reduce((sum, row) => sum + row.unobservedResponses, 0),
        decodedResponseBytes: samples.reduce(
          (sum, row) => sum + row.api.reduce((bytes, api) => bytes + api.decodedBytes, 0),
          0,
        ),
      };
    });
    await writeFile(
      "user-flow-latency.json",
      JSON.stringify(
        {
          schema: 1,
          completed,
          commit: process.env["GITHUB_SHA"],
          run: process.env["GITHUB_RUN_ID"],
          node: process.version,
          cpuCount: cpus().length,
          cpuModel: cpus()[0]?.model,
          runnerMemoryBytes: totalmem(),
          profile: "GitHub hosted runner, no production cgroup limits; one desktop Chromium user",
          migrations: "001-013 only; dedicated ephemeral service",
          cache: "first sample per format is warmup; remaining browser/HTTP cache is not disabled",
          pacing:
            "minimum3500ms between registration samples, outside measured phases; source write20/min unchanged",
          fixture:
            "small synthetic native packages; 31 files per format/team; growing upload/read population",
          excluded: [
            "production network",
            "DB query and lock attribution",
            "app RSS/CPU",
            "OCR",
            "multi-user load",
            "actual worker idle scheduling",
          ],
          queueBoundary:
            "controlled claim after pending UI and blocked download check; observed queue age includes harness verification",
          responseBytes:
            "decoded API body bytes, requests responding within phase; not wire bytes or every late request",
          resourceScope:
            "resourceUsage is harness and inline native extraction only, not Next or PostgreSQL",
          sizes,
          checks,
          resourceStart: usageStart,
          resourceEnd: process.resourceUsage(),
          summary,
          rows,
        },
        null,
        2,
      ),
    );
    await pool.end();
  }
});
