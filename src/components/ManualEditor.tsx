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
import { NOT_APPLICABLE, toSections, withSection } from "../lib/sections";
import { ManualCitationPanel } from "./ManualCitationPanel";
import { ManualContent } from "./ManualContent";
import { useUnsavedChanges } from "./useUnsavedChanges";

const lines = (list: readonly string[]) => list.map((line) => line.trim()).filter(Boolean);
// 입력 중인 목록은 빈 줄까지 그대로 보여 줘야 줄바꿈이 사라지지 않는다.
function rawItems(draft: ManualDraft, id: string): readonly string[] {
  if ("sections" in draft) return draft.sections.find((section) => section.id === id)?.items ?? [];
  const value = Reflect.get(draft, id);
  return Array.isArray(value) ? value : [];
}
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
    // 입력 중에는 빈 줄을 그대로 두고, 저장할 때 목록의 빈 줄을 뺀다.
    const normalized =
      "sections" in draft
        ? {
            ...draft,
            sections: draft.sections.map((section) => ({
              ...section,
              items: lines(section.items),
            })),
          }
        : toSections(draft)
            .filter((section) => section.kind === "list" && section.state !== "na")
            .reduce<ManualDraft>(
              (next, section) => withSection(next, section.id, section.items),
              draft,
            );
    const parsed = ManualDraftSchema.safeParse({
      ...normalized,
      unknowns: lines(draft.unknowns),
    });
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
  const sections = toSections(draft);
  const empty = sections.filter((section) => section.state === "empty");
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
      {empty.length > 0 && (
        <section className="panel" aria-labelledby="empty-sections">
          <h2 id="empty-sections">채우지 못한 항목 {empty.length}개</h2>
          <p className="help">
            {"sections" in draft
              ? "근거를 찾지 못해 비워 둔 항목입니다. 채우거나 해당 없음으로 표시해야 게시할 수 있습니다."
              : "원본에서 근거를 찾지 못해 비워 둔 항목입니다. 게시 필수 항목은 채워야 게시할 수 있습니다."}
          </p>
          <ul className="empty-sections">
            {empty.map((section) => (
              <li key={section.id}>
                <strong>{section.name}</strong>
                {section.required && <span className="badge">게시 필수</span>}
                {section.guide && <span className="help">{section.guide}</span>}
                <span className="actions">
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`${section.name} 답하기`}
                    onClick={() => document.getElementById(section.id)?.focus()}
                  >
                    답하기
                  </button>
                  {!section.required && (
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`${section.name} 해당 없음`}
                      onClick={() => setDraft(withSection(draft, section.id, null))}
                    >
                      해당 없음
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
          {"template" in draft && (
            <p className="help">양식: {draft.template.name} (만들 당시 항목의 복사본)</p>
          )}
          {sections.map((section) => (
            <div key={section.id}>
              <label htmlFor={section.id}>{section.name}</label>
              <textarea
                id={section.id}
                rows={section.kind === "list" ? 4 : 3}
                value={
                  section.state === "na"
                    ? NOT_APPLICABLE
                    : section.kind === "list"
                      ? rawItems(draft, section.id).join("\n")
                      : (section.text ?? "")
                }
                maxLength={section.kind === "list" ? undefined : 4000}
                onChange={(e) =>
                  setDraft(
                    withSection(
                      draft,
                      section.id,
                      section.kind === "list" ? e.target.value.split("\n") : e.target.value,
                    ),
                  )
                }
                aria-describedby={`${section.id}-help`}
              />
              <p className="help" id={`${section.id}-help`}>
                {[
                  section.guide,
                  section.kind === "list" &&
                    "한 줄에 한 항목. 비어 있는 줄은 저장할 때 제외됩니다.",
                  section.state === "na"
                    ? "해당 없음으로 표시됨"
                    : section.state === "filled" &&
                      (section.by === "human" ? "담당자 작성" : section.by === "ai" && "AI 초안"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ))}
          <div>
            <label htmlFor="unknowns">미확인 항목</label>
            <textarea
              id="unknowns"
              rows={4}
              value={draft.unknowns.join("\n")}
              onChange={(e) => setDraft({ ...draft, unknowns: e.target.value.split("\n") })}
              aria-describedby="unknowns-help"
            />
            <p className="help" id="unknowns-help">
              한 줄에 한 항목. 비어 있는 줄은 저장할 때 제외됩니다.
            </p>
          </div>
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
