import type { ManualDraft } from "./schemas.ts";

export const NOT_APPLICABLE = "해당 없음";
// 게시 필수 항목은 "해당 없음"으로 둘 수 없다.
const fields = [
  { id: "purpose", name: "업무 목적", kind: "text", required: true },
  { id: "trigger", name: "시작 조건", kind: "text", required: false },
  { id: "cadence", name: "주기", kind: "text", required: false },
  { id: "ownerRole", name: "담당 역할", kind: "text", required: false },
  { id: "resources", name: "준비 자료", kind: "list", required: false },
  { id: "systems", name: "사용 시스템", kind: "list", required: false },
  { id: "steps", name: "업무 순서", kind: "list", required: true },
  { id: "warnings", name: "주의 사항", kind: "list", required: false },
  { id: "exceptions", name: "예외 상황", kind: "list", required: false },
  { id: "completion", name: "완료 기준", kind: "text", required: true },
] as const;
export type SectionId = (typeof fields)[number]["id"];
export type Section = {
  readonly id: SectionId;
  readonly name: string;
  readonly kind: "text" | "list";
  readonly required: boolean;
  readonly text: string | null;
  readonly items: readonly string[];
  readonly state: "filled" | "empty" | "na";
};
// shortcut: 기본 10개 항목 형태만 다룬다, 양식 형태 초안(설계 6절)을 저장하기 시작할 때 sections 분기를 더한다.
export function toSections(draft: ManualDraft): Section[] {
  return fields.map((field) => {
    const value = draft[field.id];
    const items = Array.isArray(value) ? value.filter((line) => line.trim()) : [];
    const text = typeof value === "string" && value.trim() ? value : null;
    const only = text ?? (items.length === 1 ? items[0] : undefined);
    const state =
      text === null && !items.length
        ? "empty"
        : !field.required && only?.trim() === NOT_APPLICABLE
          ? "na"
          : "filled";
    return { ...field, text, items, state };
  });
}
export const emptySections = (draft: ManualDraft) =>
  toSections(draft).filter((section) => section.state === "empty");
