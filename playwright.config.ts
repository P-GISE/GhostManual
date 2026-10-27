import { defineConfig, devices } from "@playwright/test";
import { e2eMailDir } from "./tests/e2e/mail-dir";
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
      MAIL_DRIVER: "file",
      MAIL_DIR: e2eMailDir,
      TRUST_CLOUDFLARE: "true",
      IP_HASH_SECRET: "test-only-rate-secret-00000000000000000000",
      DATABASE_URL:
        process.env["DATABASE_URL"] ?? "postgresql://ghostmanual@127.0.0.1:55432/ghostmanual_test",
    },
  },
});
