import { expect, it } from "vitest";
import { ManualDraftSchema, parseTextUpload } from "../../src/lib/schemas.ts";

it("requires a dot before the supported extension", async () => {
  await expect(
    parseTextUpload(new File(["가".repeat(100)], "filetxt"), "업무"),
  ).rejects.toMatchObject({ code: "unsupported_file" });
});
it("allows multi-digit paragraph IDs", () => {
  const result = ManualDraftSchema.safeParse({
    title: "업무",
    purpose: null,
    trigger: null,
    cadence: null,
    ownerRole: null,
    resources: [],
    systems: [],
    steps: [],
    warnings: [],
    exceptions: [],
    completion: null,
    unknowns: [],
    references: [{ field: "title", paragraphId: "p12", quote: "업무" }],
  });
  expect(result.success).toBe(true);
});
