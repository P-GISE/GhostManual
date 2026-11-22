import { expect, it } from "vitest";
import { publishedSchema } from "../../src/lib/client.ts";
import { FileHistorySchema } from "../../src/lib/file-sources.ts";

const legacy = {
  v: 1,
  revisions: [
    {
      revision: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      uploadedByName: null,
      uploadedByDepartment: null,
      fileName: "synthetic.xlsx",
      compareStatus: "first",
      aiSummary: null,
      changes: [],
      questions: [{ question: "왜 변경했나요?", answer: "업무 요청", skipped: false }],
    },
  ],
};
it("preserves old v1 history without adding or requiring followup fields", () => {
  expect(FileHistorySchema.parse(legacy)).toEqual(legacy);
  expect(FileHistorySchema.nullable().parse(null)).toBeNull();
  const wire = JSON.parse(JSON.stringify(legacy));
  expect(publishedSchema.shape.history.parse(wire)).toEqual(wire);
});
it("preserves optional followup data in v1 history and rejects conflicting answers", () => {
  const followup = {
    question: "어떤 요청이었나요?",
    answer: null as string | null,
    skipped: false,
  };
  const history = structuredClone(legacy);
  const withFollowup = {
    ...history,
    revisions: history.revisions.map((revision) => ({
      ...revision,
      questions: revision.questions.map((question) => ({ ...question, followup })),
    })),
  };
  expect(FileHistorySchema.parse(withFollowup).revisions[0]?.questions[0]?.followup).toEqual(
    followup,
  );
  const wire = JSON.parse(JSON.stringify(withFollowup));
  expect(publishedSchema.shape.history.parse(wire)).toEqual(wire);
  followup.answer = "합성 답변";
  expect(FileHistorySchema.parse(withFollowup).revisions[0]?.questions[0]?.followup?.answer).toBe(
    "합성 답변",
  );
  followup.skipped = true;
  expect(FileHistorySchema.safeParse(withFollowup).success).toBe(false);
});
