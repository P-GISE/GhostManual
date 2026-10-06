"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, type Manual, manualSchema, message, read } from "../lib/client";
import { ManualContent } from "./ManualContent";
import { ManualVersionComparison } from "./ManualVersionComparison";
import { QuestionForm } from "./QuestionForm";

const activeShareSchema = z.object({ id: z.uuid(), manualId: z.uuid(), expiresAt: z.string() });
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
  const [share, setShare] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [activeShares, setActiveShares] = useState<z.infer<typeof activeShareSchema>[]>([]);
  useEffect(() => {
    if (!reader)
      read(`/api/shares?manualId=${id}`, z.array(activeShareSchema))
        .then(setActiveShares)
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
  async function sharing() {
    setBusy(true);
    try {
      setShare(
        z
          .object({ id: z.uuid(), url: z.string(), expiresAt: z.string() })
          .parse(await http.post("/api/shares", { json: { manualId: id } }).json()),
      );
      setActiveShares(await read(`/api/shares?manualId=${id}`, z.array(activeShareSchema)));
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(shareId: string) {
    setBusy(true);
    try {
      await http.delete(`/api/shares/${shareId}`);
      if (share?.id === shareId) setShare(null);
      setActiveShares((current) => current.filter((item) => item.id !== shareId));
    } catch (e) {
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
      <span className="eyebrow">{reader ? "SHARED / 읽기·질문 전용" : "MANUAL / 업무 매뉴얼"}</span>
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
              <p className="help">검수된 버전만 읽기·질문 전용으로 공유합니다.</p>
              <button
                type="button"
                className="secondary"
                disabled={busy || !manual.publishedVersion || manual.needsReview}
                onClick={sharing}
              >
                공유 링크 만들기
              </button>
              {share && (
                <>
                  <label htmlFor="share-url">읽기 전용 링크</label>
                  <input
                    id="share-url"
                    readOnly
                    value={new URL(share.url, window.location.origin).href}
                  />
                  <p className="help">만료 {new Date(share.expiresAt).toLocaleString("ko-KR")}</p>
                </>
              )}
              <h3>활성 공유 {activeShares.length}개</h3>
              {activeShares.length === 0 && <p className="help">활성 공유가 없습니다.</p>}
              {activeShares.map((item, index) => (
                <div key={item.id}>
                  <p className="help">
                    공유 {index + 1} · 만료 {new Date(item.expiresAt).toLocaleString("ko-KR")}
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => revoke(item.id)}
                  >
                    이 공유 취소
                  </button>
                </div>
              ))}
            </section>
          )}
          <h2>원본 근거</h2>
          {content.references.length ? (
            content.references.map((r) => (
              <details key={`${r.paragraphId}-${r.field}-${r.quote}`}>
                <summary>
                  {r.field} · 문단 {r.paragraphId}
                </summary>
                <p className="source-text">{r.quote}</p>
                <Link href={`/sources/${manual.sourceId}#${r.paragraphId}`}>원본 위치 보기</Link>
              </details>
            ))
          ) : (
            <p className="muted">
              등록된 원본 인용이 없습니다. 담당자 추가 내용은 검수 시 확인하세요.
            </p>
          )}
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
