import { expect, test } from "vitest";
import { ManualDraftSchema } from "../../src/lib/schemas.ts";
import {
  blockingSections,
  emptySections,
  toSections,
  withSection,
} from "../../src/lib/sections.ts";

const section = (id: string, kind: "text" | "list", extra: object = {}) => ({
  id,
  name: `항목 ${id}`,
  guide: "",
  kind,
  text: null,
  items: [],
  state: "empty",
  by: "ai",
  ...extra,
});
const parse = (sections: object[]) =>
  ManualDraftSchema.parse({
    title: "인계서",
    template: { id: "018f4f3a-0000-7000-8000-000000000001", name: "인계서.docx" },
    sections,
    unknowns: [],
    references: [],
  });

test("양식 형태는 내용에서 상태를 정하고 해당 없음이면 내용을 비운다", () => {
  const draft = parse([
    section("a", "text", { text: "사유", state: "empty" }),
    section("b", "list", { items: ["한 줄"], state: "na" }),
    section("c", "list", { state: "filled" }),
  ]);
  expect(toSections(draft).map((s) => [s.id, s.state, s.text, s.items])).toEqual([
    ["a", "filled", "사유", []],
    ["b", "na", null, []],
    ["c", "empty", null, []],
  ]);
  // 양식 형태는 빈 항목 전부가 게시를 막는다.
  expect(blockingSections(draft).map((s) => s.id)).toEqual(["c"]);
});

test("같은 id가 둘이면 거부한다", () => {
  expect(() => parse([section("a", "text"), section("a", "list")])).toThrow();
});

test("항목을 고치면 담당자 작성이 되고 다른 항목은 그대로다", () => {
  const draft = parse([section("a", "text"), section("b", "list")]);
  const answered = withSection(withSection(draft, "a", "직접 쓴 답"), "b", null);
  expect(toSections(answered).map((s) => [s.state, s.by])).toEqual([
    ["filled", "human"],
    ["na", "human"],
  ]);
  expect(emptySections(answered)).toEqual([]);
  expect(toSections(withSection(answered, "b", ["첫째", "둘째"]))[1]).toMatchObject({
    state: "filled",
    items: ["첫째", "둘째"],
  });
});

test("기본 형태에서도 같은 함수로 답하고 해당 없음을 넣는다", () => {
  const draft = ManualDraftSchema.parse({
    title: "정산",
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
  });
  const next = withSection(withSection(draft, "cadence", null), "systems", null);
  expect(next).toMatchObject({ cadence: "해당 없음", systems: ["해당 없음"] });
  expect(blockingSections(next).map((s) => s.name)).toEqual([
    "업무 목적",
    "업무 순서",
    "완료 기준",
  ]);
});
