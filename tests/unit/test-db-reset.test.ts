import { afterEach, expect, it, vi } from "vitest";
import resetTestCounters from "../reset-db.ts";

afterEach(() => vi.unstubAllEnvs());
it("rejects a production database before connecting or resetting counters", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://localhost:1/ghostmanual");
  await expect(resetTestCounters()).rejects.toThrow("restricted to a dedicated _test database");
});
it("requires an explicit test database target", async () => {
  vi.stubEnv("DATABASE_URL", "");
  await expect(resetTestCounters()).rejects.toThrow("must explicitly identify");
});
