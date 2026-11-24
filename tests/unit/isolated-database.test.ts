import { expect, it } from "vitest";
import { isolatedDatabase } from "../isolated-database.ts";

it("rejects non-test database creation and unsafe cleanup targets before connecting", async () => {
  for (const url of [
    "postgresql://fixture@example.invalid/production",
    "https://example.invalid/fixture_test",
  ])
    await expect(isolatedDatabase(13, url)).rejects.toThrow("restricted");
  for (const name of [
    "production",
    "gm_lead_fixture_test",
    "fixture_test; DROP DATABASE production",
  ])
    await expect(
      isolatedDatabase(13, "postgresql://fixture@example.invalid/fixture_test", name),
    ).rejects.toThrow("restricted");
});
