import { randomUUID } from "node:crypto";
import { defineConfig } from "vitest/config";

const compatibility = process.env["DATABASE_URL"] ? new URL(process.env["DATABASE_URL"]) : null;
if (compatibility)
  compatibility.pathname = "/gm_lead_" + randomUUID().replaceAll("-", "") + "_test";
const compatibilityFiles = [
  "tests/integration/team-lead-backend.test.ts",
  "tests/integration/team-lead-expand.test.ts",
  "tests/integration/overview-compat.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          globalSetup: ["./tests/reset-db.ts"],
          include: ["tests/integration/**/*.test.ts"],
          exclude: compatibilityFiles,
          fileParallelism: false,
          testTimeout: 15000,
          hookTimeout: 30000,
        },
      },
      {
        test: {
          name: "integration-013",
          include: compatibilityFiles,
          globalSetup: ["./tests/setup-lead-compat.ts"],
          env: compatibility
            ? {
                DATABASE_URL: compatibility.toString(),
                GHOSTMANUAL_TEST_ADMIN_URL: process.env["DATABASE_URL"] ?? "",
              }
            : {},
          fileParallelism: false,
          testTimeout: 15000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
