import type { ManualDraft } from "../lib/schemas";

export const manualFields = [
  { key: "purpose", label: "업무 목적" },
  { key: "trigger", label: "시작 조건" },
  { key: "cadence", label: "주기" },
  { key: "ownerRole", label: "담당 역할" },
  { key: "resources", label: "준비 자료" },
  { key: "systems", label: "사용 시스템" },
  { key: "steps", label: "업무 순서" },
  { key: "warnings", label: "주의 사항" },
  { key: "exceptions", label: "예외 상황" },
  { key: "completion", label: "완료 기준" },
  { key: "unknowns", label: "미확인 항목" },
] as const;
export function ManualContent({ content }: { readonly content: ManualDraft }) {
  return (
    <article className="document">
      {manualFields.map((f) => {
        const value = content[f.key];
        return (
          <section key={f.key}>
            <h3>{f.label}</h3>
            {Array.isArray(value) ? (
              value.length ? (
                <ol>
                  {value.map((v) => (
                    <li key={`${f.key}-${v}`}>{v || "내용 미입력"}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted">확인된 내용 없음</p>
              )
            ) : (
              <p>{value ?? "확인된 내용 없음"}</p>
            )}
          </section>
        );
      })}
    </article>
  );
}
