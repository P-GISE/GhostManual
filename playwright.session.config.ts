import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/session",
  outputDir: ".omo/evidence/ghost-session/browser-results",
  workers: 1,
  retries: 0,
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:3321",
    channel: "chrome",
    trace: "off",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3321",
    url: "http://127.0.0.1:3321",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      AI_ENABLED: "false",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    },
  },
});
