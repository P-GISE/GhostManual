"use client";
import { HTTPError } from "ky";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { http, type Manual, manualSchema, message, type Source, sourceSchema } from "../lib/client";
import { type RequestStage, requestDiagnostic } from "../lib/request-diagnostic";
import { RequestDiagnostics, useRequestDiagnostics } from "./RequestDiagnostics";
export function ManualList() {
  const { record } = useRequestDiagnostics();
  const mounted = useRef(false);
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState<{ message: string; unauthorized: boolean } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const visibleManuals = manuals.filter(
    (m) =>
      m.draft.title
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .includes(query.trim().normalize("NFKC").toLocaleLowerCase("ko-KR")) &&
      (status === "all" ||
        (status === "review"
          ? m.needsReview
          : status === "published"
            ? !!m.publishedVersion && !m.needsReview
            : !m.publishedVersion && !m.needsReview)),
  );
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    async function diagnosedRead<T>(stage: RequestStage, path: string, schema: z.ZodType<T>) {
      let status: number | undefined;
      try {
        const response = await http.get(path);
        status = response.status;
        const value = schema.parse(await response.json());
        if (mounted.current) record(requestDiagnostic(stage, undefined, status));
        return value;
      } catch (failure) {
        if (mounted.current) record(requestDiagnostic(stage, failure, status));
        throw failure;
      }
    }
    try {
      const [m, s] = await Promise.all([
        diagnosedRead("manuals", "/api/manuals", z.array(manualSchema)),
        diagnosedRead("sources", "/api/sources", z.array(sourceSchema)),
      ]);
      setManuals(m);
      setSources(s);
    } catch (e) {
      setLoadError({
        message: await message(e),
        unauthorized: e instanceof HTTPError && e.response.status === 401,
      });
    } finally {
      setBusy(false);
    }
  }, [record]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  async function remove() {
    setDeleting(true);
    try {
      await http.delete("/api/me");
      window.location.assign("/");
    } catch (e) {
      setError(await message(e));
      setDeleting(false);
    }
  }
  async function loadExample() {
    setBusy(true);
    setError("");
    try {
      await http.post("/api/workspace/example");
      await load();
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  if (loadError) {
    return (
      <section className="panel">
        <h1>업무 문서함</h1>
        <p className="error" role="alert">
          {loadError.message}
        </p>
        <RequestDiagnostics />
        {loadError.unauthorized ? (
          <p className="help">
            이 브라우저에서 로그인 상태를 확인할 수 없습니다. 앱 안에서 연 경우 메뉴에서 Safari 또는
            Chrome으로 이 주소를 열고 다시 로그인해 주세요.
          </p>
        ) : (
          <button type="button" disabled={busy} onClick={load}>
            문서함 다시 불러오기
          </button>
        )}
        <p>
          {loadError.unauthorized ? (
            <Link href="/login?next=%2Fmanuals">로그인 화면으로</Link>
          ) : (
            <Link href="/">시작 화면으로</Link>
          )}
        </p>
      </section>
    );
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">내 문서함</span>
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
          <div className="actions">
            <Link href="/sources/new">첫 자료 등록하기</Link>
            <button type="button" className="secondary" disabled={busy} onClick={loadExample}>
              예제 불러오기
            </button>
          </div>
        </div>
      )}
      {!busy && manuals.length > 0 && (
        <>
          <div className="filter-bar">
            <div>
              <label htmlFor="manual-search">매뉴얼 제목 검색</label>
              <input
                id="manual-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="manual-status">검수 상태</label>
              <select id="manual-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">전체</option>
                <option value="draft">미검수 초안</option>
                <option value="published">게시본 있음</option>
                <option value="review">재검토 필요</option>
              </select>
            </div>
          </div>
          <p className="help" role="status">
            전체 {manuals.length}개 중 {visibleManuals.length}개 표시
          </p>
          {visibleManuals.length === 0 && (
            <p className="muted">검색·상태 조건에 맞는 매뉴얼이 없습니다.</p>
          )}
        </>
      )}
      {visibleManuals.map((m) => (
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
        <summary>계정 삭제</summary>
        <p>계정과 원본, 매뉴얼, 답변, 공유 권한을 모두 삭제합니다. 복구할 수 없습니다.</p>
        <label className="check">
          <input type="checkbox" onChange={(e) => setDeleting(e.target.checked)} />
          삭제할 내용을 확인했습니다.
        </label>
        <button type="button" className="secondary" disabled={!deleting} onClick={remove}>
          계정과 문서 영구 삭제
        </button>
      </details>
    </>
  );
}
