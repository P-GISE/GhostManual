import { expect, it } from "vitest";
import { buildQuestions, compareSnapshots, readXlsx } from "../../src/lib/xlsx/index.ts";

it("exports the API team's agreed engine contract", () => {
  expect(typeof readXlsx).toBe("function");
  expect(typeof compareSnapshots).toBe("function");
  expect(buildQuestions([], true)).toEqual([
    { kind: "purpose", question: "이 파일은 어떤 업무를 위한 것인가요?", groupIndexes: [] },
    { kind: "origin", question: "자료는 어디서 가져왔나요?", groupIndexes: [] },
  ]);
  expect(buildQuestions(null, false)).toEqual([
    { kind: "other", question: "이번 버전에서 무엇을, 왜 바꿨나요?", groupIndexes: [] },
  ]);
  expect(buildQuestions([], false)).toEqual([]);
});
