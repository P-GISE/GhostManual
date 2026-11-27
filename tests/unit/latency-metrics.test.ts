import { describe, expect, test } from "vitest";
import { apiCategory, assertLatencyTarget, percentile } from "../performance/latency-metrics.ts";

const safe = {
  GITHUB_ACTIONS: "true",
  AI_ENABLED: "false",
  APP_ORIGIN: "http://localhost:3200",
  DATABASE_URL: "postgresql://localhost:5432/ghostmanual_latency_test",
};
describe("isolated latency measurements", () => {
  test("nearest-rank percentiles retain outliers and do not mutate samples", () => {
    const samples = Array.from({ length: 30 }, (_, index) => 30 - index);
    expect(percentile(samples, 0.5)).toBe(15);
    expect(percentile(samples, 0.95)).toBe(29);
    expect(samples[0]).toBe(30);
    for (const invalid of [[], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])
      expect(() => percentile(invalid, 0.95)).toThrow();
    expect(() => percentile([1], 0)).toThrow();
  });
  test("refuses production, non-CI, enabled AI, and other databases", () => {
    expect(() => assertLatencyTarget(safe)).not.toThrow();
    for (const patch of [
      { GITHUB_ACTIONS: "false" },
      { AI_ENABLED: "true" },
      { APP_ORIGIN: "https://ghostmanual.pigs0516.com" },
      { DATABASE_URL: "postgresql://localhost/ghostmanual" },
      { DATABASE_URL: "postgresql://production/ghostmanual_latency_test" },
    ])
      expect(() => assertLatencyTarget({ ...safe, ...patch })).toThrow();
  });
  test("retains route categories without IDs, search terms or fragments", () => {
    expect(
      apiCategory(
        "http://localhost:3200/api/sources/12345678-1234-1234-1234-123456789abc/revisions/1/document?secret=hidden#token",
      ),
    ).toBe("/api/sources/:id/revisions/:revision/document");
  });
});
