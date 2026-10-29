import { defineConfig } from "@playwright/test";

const { A11Y_CHROMIUM_PATH: chromiumPath } = process.env;

// Public, read-only pages: no global DB reset or production connection.
export default defineConfig({
  testDir: "./tests/accessibility",
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3320",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3320",
    url: "http://127.0.0.1:3320",
    reuseExistingServer: false,
    timeout: 120000,
    env: { AI_ENABLED: "false", GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com" },
  },
});
