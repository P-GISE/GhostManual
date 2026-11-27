import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { assertLatencyTarget } from "./latency-metrics.ts";

assertLatencyTarget(process.env);
const mailDir = join(tmpdir(), "ghostmanual-latency-mail");
process.env["E2E_MAIL_DIR"] = mailDir;
export default defineConfig({
  testDir: ".",
  testMatch: "user-flows.spec.ts",
  globalSetup: "./setup-latency.ts",
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  outputDir: "../../latency-test-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3200",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run start",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    url: "http://localhost:3200",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env["DATABASE_URL"] ?? "",
      APP_ORIGIN: "http://localhost:3200",
      AI_ENABLED: "false",
      MAIL_DRIVER: "file",
      MAIL_DIR: mailDir,
      TRUST_CLOUDFLARE: "true",
      IP_HASH_SECRET: "latency-only-synthetic-secret-at-least-32-characters",
    },
  },
});
