"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  http,
  type Manual,
  manualSchema,
  message,
  read,
  type Source,
  sourceSchema,
} from "../lib/client";
import { type ManualDraft, ManualDraftSchema } from "../lib/schemas";
import { ManualCitationPanel } from "./ManualCitationPanel";
import { ManualContent } from "./ManualContent";
import { useUnsavedChanges } from "./useUnsavedChanges";

const textFields = [
  { key: "purpose", label: "업무 목적" },
  { key: "trigger", label: "시작 조건" },
  { key: "cadence", label: "주기" },
  { key: "ownerRole", label: "담당 역할" },
  { key: "completion", label: "완료 기준" },
] as const;
const listFields = [
  { key: "resources", label: "준비 자료" },
  { key: "systems", label: "사용 시스템" },
  { key: "steps", label: "업무 순서" },
  { key: "warnings", label: "주의 사항" },
  { key: "exceptions", label: "예외 상황" },
  { key: "unknowns", label: "미확인 항목" },
] as const;
export function ManualEditor({ id }: { readonly id: string }) {
  const [manual, setManual] = useState<Manual | null>(null);
  const [draft, setDraft] = useState<ManualDraft | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [reviewedSource, setReviewedSource] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  useUnsavedChanges(!!draft && !!manual && JSON.stringify(draft) !== JSON.stringify(manual.draft));
  useEffect(() => {
    read(`/api/manuals/${id}`, manualSchema)
      .then(async (m) => {
        const currentSource = await read(`/api/sources/${m.sourceId}`, sourceSchema);
        setSource(currentSource);
        setManual(m);
        setDraft(m.draft);
      })
      .catch(async (e) => setError(await message(e)));
  }, [id]);
  async function save() {
    if (!manual || !draft || !source) return;
    if (source.revisionId !== manual.sourceRevisionId && !reviewedSource) {
      setError("변경된 원본을 확인하고 재검토 확인란을 선택하세요.");
      return;
    }
    const normalized = { ...draft };
    for (const field of listFields)
      normalized[field.key] = draft[field.key].map((line) => line.trim()).filter(Boolean);
    const parsed = ManualDraftSchema.safeParse(normalized);
    if (!parsed.success) {
      setError("제목과 각 항목의 길이를 확인하세요. 빈 목록 줄은 제거해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const m = manualSchema.parse(
        await http
          .patch(`/api/manuals/${id}`, {
            json: {
              sourceRevisionId: source.revisionId,
              draft: parsed.data,
              expectedDraftRevision: manual.draftRevision,
            },
          })
          .json(),
      );
      setManual(m);
      setDraft(m.draft);
      setSaved("초안을 저장했습니다. 검수 후 게시할 수 있습니다.");
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!draft || !manual || !source)
    return <p role="status">{error || "매뉴얼 초안을 불러오고 있습니다."}</p>;
  const currentParagraphs = source.text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((text, index) => ({ id: `p${index + 1}`, text: text.trim() }));
  const invalidReferences = draft.references.filter(
    (ref) =>
      !currentParagraphs.some(
        (paragraph) => paragraph.id === ref.paragraphId && paragraph.text.includes(ref.quote),
      ),
  );
  return (
    <>
      <span className="eyebrow">미검수 초안</span>
      <h1>매뉴얼 수정</h1>
      <p className="muted">
        원본에서 확인한 내용과 담당자가 보완한 내용을 함께 검토하세요. 저장은 게시와 다릅니다.
      </p>
      {source.revisionId !== manual.sourceRevisionId && (
        <div className="notice">
          <p>
            원본이 버전 {source.revision}로 변경되었습니다. 아래 현재 원본과 모든 업무 항목·인용을
            다시 검토하세요.
          </p>
          <label>
            <input
              type="checkbox"
              checked={reviewedSource}
              onChange={(event) => setReviewedSource(event.target.checked)}
            />
            변경된 원본과 초안의 모든 항목을 다시 확인했습니다.
          </label>
        </div>
      )}
      {invalidReferences.length > 0 && (
        <p role="alert" className="error">
          현재 원본과 일치하지 않는 인용 {invalidReferences.length}개가 있습니다. 원본과 비교하여
          수정하거나 삭제하세요.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="notice" role="status">
          {saved}
        </p>
      )}
      <div className="split">
        <section className="editor-form">
          <label htmlFor="manual-title">매뉴얼 제목</label>
          <input
            id="manual-title"
            value={draft.title}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          {textFields.map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key}>{f.label}</label>
              <textarea
                id={f.key}
                rows={3}
                value={draft[f.key] ?? ""}
                maxLength={4000}
                onChange={(e) =>
                  setDraft({ ...draft, [f.key]: e.target.value.trim() ? e.target.value : null })
                }
              />
            </div>
          ))}
          {listFields.map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key}>{f.label}</label>
              <textarea
                id={f.key}
                rows={4}
                value={draft[f.key].join("\n")}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.split("\n") })}
                aria-describedby={`${f.key}-help`}
              />
              <p className="help" id={`${f.key}-help`}>
                한 줄에 한 항목. 비어 있는 줄은 저장할 때 제외됩니다.
              </p>
            </div>
          ))}
          <div className="actions">
            <button type="button" disabled={busy || invalidReferences.length > 0} onClick={save}>
              {busy ? "저장 중…" : "초안 저장"}
            </button>
            <Link className="button secondary" href={`/manuals/${id}`}>
              검수 화면
            </Link>
          </div>
        </section>
        <aside>
          <ManualCitationPanel
            source={source}
            draft={draft}
            setDraft={setDraft}
            invalidReferences={invalidReferences}
          />
          <h2>현재 초안 미리보기</h2>
          <ManualContent content={draft} />
        </aside>
      </div>
    </>
  );
}
