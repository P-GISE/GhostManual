import { expect, test } from "vitest";
import type { ManualDraft } from "../../src/lib/schemas.ts";
import { emptySections, toSections } from "../../src/lib/sections.ts";

const draft: ManualDraft = {
  title: "월간 정산",
  purpose: "정산 마감",
  trigger: null,
  cadence: "해당 없음",
  ownerRole: null,
  resources: ["해당 없음"],
  systems: [],
  steps: ["자료 받기", "검토하기"],
  warnings: ["", "  "],
  exceptions: [],
  completion: null,
  unknowns: ["담당 부서"],
  references: [],
};

test("기본 형태를 10개 항목 순서대로 바꾸고 내용을 보존한다", () => {
  const sections = toSections(draft);
  expect(sections.map((s) => s.name)).toEqual([
    "업무 목적",
    "시작 조건",
    "주기",
    "담당 역할",
    "준비 자료",
    "사용 시스템",
    "업무 순서",
    "주의 사항",
    "예외 상황",
    "완료 기준",
  ]);
  expect(sections[0]).toMatchObject({ kind: "text", text: "정산 마감", state: "filled" });
  expect(sections[6]).toMatchObject({ kind: "list", items: ["자료 받기", "검토하기"] });
});

test("빈 항목과 해당 없음을 구분한다", () => {
  const state = Object.fromEntries(toSections(draft).map((s) => [s.id, s.state]));
  expect(state).toMatchObject({
    cadence: "na",
    resources: "na",
    trigger: "empty",
    warnings: "empty",
  });
  expect(emptySections(draft).map((s) => s.id)).toEqual([
    "trigger",
    "ownerRole",
    "systems",
    "warnings",
    "exceptions",
    "completion",
  ]);
});

test("게시 필수 항목은 해당 없음으로 치지 않는다", () => {
  const sections = toSections({ ...draft, purpose: "해당 없음", steps: ["해당 없음"] });
  expect(sections.filter((s) => s.required).map((s) => s.state)).toEqual([
    "filled",
    "filled",
    "empty",
  ]);
});
