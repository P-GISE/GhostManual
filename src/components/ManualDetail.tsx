"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, type Manual, manualSchema, message, read } from "../lib/client";
import { ManualContent } from "./ManualContent";
import { ManualVersionComparison } from "./ManualVersionComparison";
import { QuestionForm } from "./QuestionForm";

const sharingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("private") }),
  z.object({ mode: z.literal("link"), url: z.string() }),
]);
type Sharing = z.infer<typeof sharingSchema>;
export function ManualDetail({
  id,
  reader = false,
}: {
  readonly id: string;
  readonly reader?: boolean;
}) {
  const [manual, setManual] = useState<Manual | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [unknowns, setUnknowns] = useState(false);
  const [sharing, setSharing] = useState<Sharing>({ mode: "private" });
  // The radio reflects the choice immediately; the link appears when the server confirms.
  const [sharingMode, setSharingMode] = useState<Sharing["mode"]>("private");
  useEffect(() => {
    if (!reader)
      read(`/api/shares?manualId=${id}`, sharingSchema)
        .then((value) => {
          setSharing(value);
          setSharingMode(value.mode);
        })
        .catch(async (e) => setError(await message(e)));
    read(`/api/manuals/${id}`, manualSchema, reader)
      .then(setManual)
      .catch(async (e) => setError(await message(e)));
  }, [id, reader]);
  async function publish() {
    if (!manual) return;
    setBusy(true);
    setError("");
    try {
      await http
        .post(`/api/manuals/${id}/publish`, {
          json: {
            expectedRevision: manual.draftRevision,
            acknowledgedUnknowns: unknowns ? manual.draft.unknowns : [],
          },
        })
        .json();
      setManual(await read(`/api/manuals/${id}`, manualSchema));
      setConfirmed(false);
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeSharing(mode: Sharing["mode"]) {
    setBusy(true);
    setError("");
    setSharingMode(mode);
    try {
      setSharing(
        sharingSchema.parse(await http.put("/api/shares", { json: { manualId: id, mode } }).json()),
      );
    } catch (e) {
      setSharingMode(sharing.mode);
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }

  if (!manual) return <p role="status">{error || "매뉴얼을 불러오고 있습니다."}</p>;
  const content = reader ? manual.published?.content : manual.draft;
  if (!content)
    return (
      <p className="error" role="alert">
        공유할 검수 버전이 없습니다.
      </p>
    );
  return (
    <>
      <span className="eyebrow">{reader ? "읽기·질문 전용" : "업무 매뉴얼"}</span>
      <h1>{content.title}</h1>
      <div className="actions">
        <span className="badge">
          {manual.needsReview
            ? "재검토 필요"
            : reader && manual.publishedVersion
              ? `검수 완료 · 버전 ${manual.publishedVersion}`
              : "초안 · 검수 전"}
        </span>
        <span className="help">
          {manual.provenance === "example"
            ? "미리 작성된 합성 예제"
            : manual.provenance === "ai"
              ? "AI 생성 후 담당자 검수 대상"
              : "담당자 작성"}
        </span>
      </div>
      {!reader && manual.publishedVersion && (
        <p className="help">
          게시 이력: <span>검수 완료 · 버전 {manual.publishedVersion}</span>. 아래 내용은 현재
          초안입니다.
        </p>
      )}
      {manual.needsReview && (
        <p className="notice">
          원본이 변경됐습니다. 다시 검수하기 전까지 신규 답변의 근거로 사용하지 않습니다.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="split">
        <ManualContent content={content} />
        <aside>
          {!reader && (
            <section className="panel">
              <h2>수정과 검수</h2>
              <p className="help">
                초안 revision {manual.draftRevision}. 초안을 확인한 뒤 검수 버전을 게시하세요.
              </p>
              <Link href={`/manuals/${id}/edit`}>초안 수정</Link>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                원본과 업무 내용을 확인했습니다.
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={unknowns}
                  onChange={(e) => setUnknowns(e.target.checked)}
                />
                미확인 항목이 남아 있음을 확인했습니다.
              </label>
              <button
                type="button"
                disabled={busy || !confirmed || (content.unknowns.length > 0 && !unknowns)}
                onClick={publish}
              >
                검수 완료·버전 게시
              </button>
              <h2>후임자에게 공유</h2>
              <fieldset className="sharing">
                <legend>공유 설정</legend>
                <label className="check">
                  <input
                    type="radio"
                    name="sharing"
                    checked={sharingMode === "private"}
                    disabled={busy}
                    onChange={() => changeSharing("private")}
                  />
                  비공개
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="sharing"
                    checked={sharingMode === "link"}
                    disabled={busy || !manual.publishedVersion || manual.needsReview}
                    onChange={() => changeSharing("link")}
                  />
                  링크가 있는 사용자 볼 수 있음
                </label>
              </fieldset>
              <p className="help">
                {sharing.mode === "link"
                  ? "링크를 받은 사람은 로그인한 뒤 검수된 버전만 읽고 질문할 수 있습니다. 비공개로 바꾸면 링크가 바로 막힙니다."
                  : manual.publishedVersion && !manual.needsReview
                    ? "나만 볼 수 있습니다. 링크 공유를 켜면 검수된 버전만 공유됩니다."
                    : "검수 완료·버전 게시 후 링크로 공유할 수 있습니다."}
              </p>
              {sharing.mode === "link" && (
                <>
                  <label htmlFor="share-url">읽기 전용 링크</label>
                  <input
                    id="share-url"
                    readOnly
                    value={new URL(sharing.url, window.location.origin).href}
                  />
                </>
              )}
            </section>
          )}
          <section className="panel evidence-panel">
            <h2>원본 근거</h2>
            {content.references.length ? (
              content.references.map((r) => (
                <details key={`${r.paragraphId}-${r.field}-${r.quote}`}>
                  <summary>
                    {r.field} · 문단 {r.paragraphId}
                  </summary>
                  <p className="source-text">{r.quote}</p>
                  <Link
                    href={`/sources/${manual.sourceId}${reader ? "?view=shared" : ""}#${r.paragraphId}`}
                  >
                    원본 위치 보기
                  </Link>
                </details>
              ))
            ) : (
              <p className="muted">
                등록된 원본 인용이 없습니다. 담당자 추가 내용은 검수 시 확인하세요.
              </p>
            )}
          </section>
        </aside>
      </div>
      {!reader && manual.published && (
        <details>
          <summary>게시된 검수 버전 {manual.published.version} 보기</summary>
          <ManualContent content={manual.published.content} />
        </details>
      )}
      {!reader && manual.publishedVersion && (
        <ManualVersionComparison id={id} latest={manual.publishedVersion} />
      )}
      <h2>이 매뉴얼에 질문</h2>
      <QuestionForm manualId={id} reader={reader} />
    </>
  );
}
