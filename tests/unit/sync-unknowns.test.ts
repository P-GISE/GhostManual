import { expect, it } from "vitest";
import { syncUnknowns } from "../../src/lib/file-sources.ts";
import { ManualDraftSchema } from "../../src/lib/schemas.ts";

const revision = (unanswered: string[], questions = unanswered) => [
  { revision: 2, questions, unanswered },
];

it("rejects pending questions when thirty human unknowns fill the draft", () => {
  const human = Array.from({ length: 30 }, (_, i) => `human ${i}`);
  expect(() => syncUnknowns(human, revision(["pending"]))).toThrow(
    expect.objectContaining({ code: "unknowns_limit", httpStatus: 422 }),
  );
  expect(human).toHaveLength(30);
});
it("preserves full human unknowns when no questions remain", () => {
  const human = Array.from({ length: 30 }, (_, i) => `human ${i}`);
  expect(syncUnknowns(human, revision([]))).toEqual(human);
});
it("uses the final slot for all pending questions without dropping human items", () => {
  const human = Array.from({ length: 29 }, (_, i) => `human ${i}`);
  const result = syncUnknowns(human, revision(["one", "two", "three"]));
  expect(result).toEqual([...human, "[v2 확인 필요] 답하지 않은 변경 질문 3건"]);
  expect(ManualDraftSchema.shape.unknowns.safeParse(result).success).toBe(true);
});
it("replaces the current revision only and bounds long questions", () => {
  const long = "x".repeat(600);
  const result = syncUnknowns(
    ["human", "[v1 확인 필요] old", "[v2 확인 필요] stale"],
    revision([long], ["stale", long]),
  );
  expect(result.slice(0, 2)).toEqual(["human", "[v1 확인 필요] old"]);
  expect(result[2]).toHaveLength(500);
  expect(ManualDraftSchema.shape.unknowns.safeParse(result).success).toBe(true);
});

it("preserves human entries that share the generated prefix or resemble a summary", () => {
  const human = ["[v2 확인 필요] 직접 수정", "[v2 확인 필요] 답하지 않은 변경 질문 99건"];
  expect(
    syncUnknowns([...human, "[v2 확인 필요] 답하지 않은 변경 질문 2건"], revision(["one", "two"])),
  ).toEqual([...human, "[v2 확인 필요] one", "[v2 확인 필요] two"]);
});
