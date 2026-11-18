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
export type Section = {
  readonly id: string;
  readonly name: string;
  readonly guide: string;
  readonly kind: "text" | "list";
  readonly required: boolean;
  readonly text: string | null;
  readonly items: readonly string[];
  readonly state: "filled" | "empty" | "na";
  // 양식 형태만 항목별 출처를 가진다.
  readonly by?: "ai" | "human";
};
// 두 초안 형태를 같은 항목 목록으로 바꾼다. 보기·PDF·검수·빈 항목 패널은 이 결과만 쓴다.
export function toSections(draft: ManualDraft): Section[] {
  if ("sections" in draft)
    return draft.sections.map((section) => ({ ...section, required: false }));
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
    return { ...field, guide: "", text, items, state };
  });
}
export const emptySections = (draft: ManualDraft) =>
  toSections(draft).filter((section) => section.state === "empty");
// 게시를 막는 빈 항목. 기본 형태는 필수 항목만, 양식 형태는 빈 항목 전부다.
export const blockingSections = (draft: ManualDraft) =>
  emptySections(draft).filter((section) => "sections" in draft || section.required);
// 항목 하나의 내용을 바꾼 새 초안. 값이 null이면 "해당 없음"이다.
export function withSection(
  draft: ManualDraft,
  id: string,
  value: string | readonly string[] | null,
): ManualDraft {
  if ("sections" in draft)
    return {
      ...draft,
      sections: draft.sections.map((section) => {
        if (section.id !== id) return section;
        const text = typeof value === "string" && value.trim() ? value : null;
        const items = Array.isArray(value) ? [...value] : [];
        return {
          ...section,
          text,
          items,
          by: "human" as const,
          state:
            value === null ? "na" : text || items.some((line) => line.trim()) ? "filled" : "empty",
        };
      }),
    };
  const field = fields.find((entry) => entry.id === id);
  if (!field) return draft;
  if (field.kind === "list")
    return {
      ...draft,
      [id]: value === null ? [NOT_APPLICABLE] : Array.isArray(value) ? value : [],
    };
  return {
    ...draft,
    [id]:
      value === null ? NOT_APPLICABLE : typeof value === "string" && value.trim() ? value : null,
  };
}
