"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  http,
  type Manual,
  manualSchema,
  message,
  read,
  type Source,
  sourceSchema,
} from "../lib/client";
export function ManualList() {
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    Promise.all([
      read("/api/manuals", z.array(manualSchema)),
      read("/api/sources", z.array(sourceSchema)),
    ])
      .then(([m, s]) => {
        setManuals(m);
        setSources(s);
      })
      .catch(async (e) => setError(await message(e)))
      .finally(() => setBusy(false));
  }, []);
  async function remove() {
    setDeleting(true);
    try {
      await http.delete("/api/workspace");
      window.location.assign("/");
    } catch (e) {
      setError(await message(e));
      setDeleting(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>업무 문서함</h1>
          <p className="muted">원본과 검수한 매뉴얼을 따로 관리합니다.</p>
        </div>
        <Link className="button" href="/sources/new">
          새 자료 등록
        </Link>
      </div>
      {busy && (
        <p className="loading" role="status">
          문서를 불러오고 있습니다.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <h2>
        매뉴얼 <span className="muted">{manuals.length}</span>
      </h2>
      {!busy && !manuals.length && (
        <div className="panel">
          <h3>아직 매뉴얼이 없습니다.</h3>
          <p className="muted">업무 자료를 등록한 다음 매뉴얼을 작성하고 검수하세요.</p>
          <Link href="/sources/new">첫 자료 등록하기</Link>
        </div>
      )}
      {manuals.map((m) => (
        <div className="row" key={m.id}>
          <div>
            <h3>
              <Link href={`/manuals/${m.id}`}>{m.draft.title}</Link>
            </h3>
            <span className="help">
              초안 revision {m.draftRevision} · 게시 버전 {m.publishedVersion ?? "없음"}
            </span>
          </div>
          <span className="badge">
            {m.needsReview
              ? "재검토 필요"
              : m.publishedVersion
                ? "게시본 있음 · 초안 별도"
                : "미검수 초안"}
          </span>
        </div>
      ))}
      <h2>
        원본 자료 <span className="muted">{sources.length}</span>
      </h2>
      {!busy && !sources.length && <p className="muted">등록된 원본 자료가 없습니다.</p>}
      {sources.map((s) => (
        <div className="row" key={s.id}>
          <Link href={`/sources/${s.id}`}>{s.title}</Link>
          <span className="help">원본 revision {s.revision}</span>
        </div>
      ))}
      <details>
        <summary>작업 공간 삭제</summary>
        <p>원본, 매뉴얼, 답변과 공유 권한을 모두 삭제합니다. 복구할 수 없습니다.</p>
        <label className="check">
          <input type="checkbox" onChange={(e) => setDeleting(e.target.checked)} />
          삭제할 내용을 확인했습니다.
        </label>
        <button type="button" className="secondary" disabled={!deleting} onClick={remove}>
          작업 공간 영구 삭제
        </button>
      </details>
    </>
  );
}
