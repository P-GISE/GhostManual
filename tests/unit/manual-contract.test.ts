import { expect, it } from "vitest";
import { AnswerModelSchema, ManualDraftSchema } from "../../src/lib/schemas.ts";

it("preserves unknown optional manual fields", () => {
  expect(
    ManualDraftSchema.safeParse({
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
      references: [],
    }).success,
  ).toBe(true);
});
it("rejects unsupported confidence percentages", () => {
  expect(
    AnswerModelSchema.safeParse({
      status: "supported",
      claims: [],
      procedure: [],
      limitations: [],
      confidence: 99,
    }).success,
  ).toBe(false);
});
it("requires evidence IDs for supported claims", () => {
  expect(
    AnswerModelSchema.safeParse({
      status: "supported",
      claims: [{ text: "승인하세요", evidenceIds: [] }],
      procedure: [],
      limitations: [],
    }).success,
  ).toBe(false);
});
