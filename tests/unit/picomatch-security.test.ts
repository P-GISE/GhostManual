import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);

it("uses the pinned CVE-2026-112366 fix through the tooling alias", () => {
  const metadata = require("picomatch/package.json");
  expect(metadata.name).toBe("@ryotsu/picomatch");
  expect(metadata.version).toBe("4.0.7-a");
});

it.each(["+(*a)", "*(*a)", "+(*)b", "+(@(*a))", "+(?(*a))", "+(*[ab])"])(
  "bounds hostile single-branch wildcard matching for %s",
  async (pattern) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       const match = require(workerData.module);
       parentPort.postMessage(match.isMatch("a".repeat(32) + "!", workerData.pattern));`,
      {
        eval: true,
        workerData: { module: require.resolve("picomatch"), pattern },
        resourceLimits: { maxOldGenerationSizeMb: 32 },
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Glob matching exceeded 2 seconds")), 2000);
        worker.once("message", () => resolve());
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code !== 0) reject(new Error("Glob worker exited with code " + code));
        });
      });
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  },
);

it("preserves the static test-file globs used by the project", () => {
  const match = require("picomatch");
  expect(match.isMatch("tests/unit/example.test.ts", "tests/unit/**/*.test.ts")).toBe(true);
  expect(match.isMatch("tests/integration/example.test.ts", "tests/unit/**/*.test.ts")).toBe(false);
  expect(match.isMatch("tests/integration/example.test.ts", "tests/integration/**/*.test.ts")).toBe(
    true,
  );
});
