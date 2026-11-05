import { expect, it } from "vitest";
import { documentQuestions } from "../../src/lib/documents/questions";
import type { DocumentChange } from "../../src/lib/documents/types";

it("asks bounded structural questions and never includes before/after content", () => {
  const changes: DocumentChange[] = Array.from({ length: 40 }, (_, i) => ({
    kind: "block_modified",
    path: `body/${i + 1}`,
    before: "SECRET_OLD",
    after: "SECRET_NEW",
  }));
  const q = documentQuestions(changes, false);
  expect(q.length).toBeGreaterThan(0);
  expect(q.length).toBeLessThanOrEqual(10);
  expect(q.every((x) => x.question.length <= 500)).toBe(true);
  expect(JSON.stringify(q)).not.toMatch(/SECRET/);
  expect(q.flatMap((x) => x.groupIndexes)).toEqual(changes.map((_, i) => i));
});
it("provides purpose and origin questions for first versions", () => {
  expect(documentQuestions([], true).map((q) => q.kind)).toEqual(["purpose", "origin"]);
  expect(documentQuestions([], false)).toEqual([]);
});
