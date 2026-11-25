import { expect, it } from "vitest";
import { progressStep, progressSteps } from "../../src/lib/task-state.ts";

const work = {
  id: "s",
  openQuestions: 0,
  manualId: null as string | null,
  publishedVersion: null as number | null,
  needsReview: false,
  unpublishedChanges: false,
};

it("names the step a task is waiting on", () => {
  expect(progressSteps[progressStep({ ...work, openQuestions: 2 })]).toBe("질문");
  // 답할 질문이 남아 있으면 매뉴얼이 있어도 질문 단계다.
  expect(progressSteps[progressStep({ ...work, openQuestions: 1, manualId: "m" })]).toBe("질문");
  expect(progressSteps[progressStep(work)]).toBe("초안");
  expect(progressSteps[progressStep({ ...work, manualId: "m" })]).toBe("검수");
  const published = { ...work, manualId: "m", publishedVersion: 1 };
  expect(progressSteps[progressStep({ ...published, needsReview: true })]).toBe("검수");
  expect(progressSteps[progressStep({ ...published, unpublishedChanges: true })]).toBe("검수");
  expect(progressStep(published)).toBe(progressSteps.length);
});
