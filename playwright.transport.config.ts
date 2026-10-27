import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/session-transport",
  outputDir: ".omo/evidence/session-transport/results",
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: "https://127.0.0.1:3443",
    ignoreHTTPSErrors: true,
    channel: process.env["CI"] ? undefined : "chrome",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node tests/session-transport/server.mjs",
    url: "https://127.0.0.1:3443",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
