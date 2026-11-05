import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The deployment image builds without tests/, so the mail folder is defined here and handed to workers.
const e2eMailDir = join(tmpdir(), "ghostmanual-e2e-mail");
process.env["E2E_MAIL_DIR"] = e2eMailDir;
// One admin address per run and project; workers inherit the value set by the main process.
process.env["E2E_ADMIN_TAG"] ??= String(Date.now());
const adminEmail = (project: string) =>
  `e2e-admin-${process.env["E2E_ADMIN_TAG"]}-${project}@example.com`;
process.env["E2E_ADMIN_DESKTOP"] = adminEmail("desktop");
process.env["E2E_ADMIN_MOBILE"] = adminEmail("mobile");
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/reset-db.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://localhost:3200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.1" },
        channel: process.env["CI"] ? undefined : "chrome",
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        extraHTTPHeaders: { "CF-Connecting-IP": "198.51.100.2" },
        channel: process.env["CI"] ? undefined : "chrome",
      },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3200",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      APP_ORIGIN: "http://localhost:3200",
      AI_ENABLED: "false",
      ADMIN_EMAILS: `${adminEmail("desktop")},${adminEmail("mobile")}`,
      MAIL_DRIVER: "file",
      MAIL_DIR: e2eMailDir,
      TRUST_CLOUDFLARE: "true",
      IP_HASH_SECRET: "test-only-rate-secret-00000000000000000000",
      DATABASE_URL:
        process.env["DATABASE_URL"] ?? "postgresql://ghostmanual@127.0.0.1:55432/ghostmanual_test",
    },
  },
});
