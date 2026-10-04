"use client";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";
import type { Source } from "../lib/client";
import type { ManualDraft } from "../lib/schemas";
export function ManualCitationPanel({
  source,
  draft,
  setDraft,
  invalidReferences,
}: {
  readonly source: Source;
  readonly draft: ManualDraft;
  readonly setDraft: Dispatch<SetStateAction<ManualDraft | null>>;
  readonly invalidReferences: ManualDraft["references"];
}) {
  return (
    <div className="panel">
      <h2>원본과 비교</h2>
      <Link href={`/sources/${source.id}`} target="_blank">
        원본 새 창에서 확인
      </Link>
      <p className="help">원본 revision을 바꾸면 기존 인용을 다시 확인해야 합니다.</p>
      <details>
        <summary>현재 원본 · 버전 {source.revision}</summary>
        <p className="source-text">{source.text}</p>
      </details>
      {draft.references.map((ref, index) => (
        <details key={`${ref.paragraphId}-${ref.field}-${ref.quote}`}>
          <summary>
            {ref.field} · {ref.paragraphId}
          </summary>
          <p className="source-text">{ref.quote}</p>
          {invalidReferences.includes(ref) && (
            <div>
              <label htmlFor={`quote-${index}`}>현재 원본의 인용 문장</label>
              <textarea
                id={`quote-${index}`}
                value={ref.quote}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    references: draft.references.map((item, position) =>
                      position === index ? { ...item, quote: event.target.value } : item,
                    ),
                  })
                }
              />
              <label htmlFor={`paragraph-${index}`}>원본 문단 번호</label>
              <input
                id={`paragraph-${index}`}
                value={ref.paragraphId}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    references: draft.references.map((item, position) =>
                      position === index ? { ...item, paragraphId: event.target.value } : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setDraft({
                    ...draft,
                    references: draft.references.filter((_, position) => position !== index),
                  })
                }
              >
                일치하지 않는 인용 삭제
              </button>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
