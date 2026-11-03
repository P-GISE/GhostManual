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
  const [filter, setFilter] = useState<"all" | "todo" | "published">("all");
  const normalize = (v: string) => v.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
  // One card per task: a source with its manual (if any), its status and the next thing to do.
  const tasks = sources.map((s) => {
    const manual = manuals.find((m) => m.sourceId === s.id);
    const published = !!manual?.publishedVersion && !manual.needsReview;
    const status = !manual
      ? { label: "매뉴얼 없음", tone: "none" }
      : manual.needsReview
        ? { label: "재검토 필요", tone: "review" }
        : published
          ? { label: `게시됨 v${manual.publishedVersion}`, tone: "done" }
          : { label: "검수 전", tone: "draft" };
    const action =
      s.openQuestions > 0
        ? { label: `답할 질문 ${s.openQuestions}개`, href: `/sources/${s.id}`, primary: true }
        : !manual
          ? { label: "매뉴얼 만들기", href: `/sources/${s.id}`, primary: true }
          : !published
            ? { label: "검수하고 게시", href: `/manuals/${manual.id}`, primary: false }
            : { label: "매뉴얼 보기", href: `/manuals/${manual.id}`, primary: false };
    return {
      source: s,
      manual,
      published,
      status,
      action,
      todo: !published || s.openQuestions > 0,
    };
  });
  const visible = tasks.filter(
    (t) =>
      normalize(`${t.source.title} ${t.manual?.draft.title ?? ""}`).includes(normalize(query)) &&
      (filter === "all" || (filter === "todo" ? t.todo : t.published)),
  );
  const chips = [
    { id: "all", label: "전체", count: tasks.length },
    { id: "todo", label: "할 일 있음", count: tasks.filter((t) => t.todo).length },
    { id: "published", label: "게시됨", count: tasks.filter((t) => t.published).length },
  ] as const;
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
          <p className="muted">
            업무 하나에 원본 파일과 매뉴얼이 함께 있습니다. 오른쪽 버튼이 지금 할 일입니다.
          </p>
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
      {!busy && !tasks.length && (
        <div className="panel">
          <h2>아직 등록한 업무가 없습니다.</h2>
          <p className="muted">업무 자료를 등록한 다음 매뉴얼을 작성하고 검수하세요.</p>
          <div className="actions">
            <Link href="/sources/new">첫 자료 등록하기</Link>
            <button type="button" className="secondary" disabled={busy} onClick={loadExample}>
              예제 불러오기
            </button>
          </div>
        </div>
      )}
      {!busy && tasks.length > 0 && (
        <>
          <div className="task-toolbar">
            <div className="task-search">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                type="search"
                aria-label="업무 검색"
                placeholder="업무 이름으로 찾기"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <fieldset className="task-chips" aria-label="상태로 거르기">
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={filter === c.id}
                  onClick={() => setFilter(c.id)}
                >
                  {c.label} {c.count}
                </button>
              ))}
            </fieldset>
          </div>
          <p className="help" role="status">
            전체 {tasks.length}개 중 {visible.length}개 표시
          </p>
          {visible.length === 0 && <p className="muted">조건에 맞는 업무가 없습니다.</p>}
          <ul className="task-list">
            {visible.map((t) => (
              <li key={t.source.id} className="task-card">
                <span className={`task-icon ${t.source.kind}`} aria-hidden="true">
                  {t.source.kind === "file" ? "XLSX" : "TXT"}
                </span>
                <div className="task-main">
                  <h2>
                    <Link
                      className="task-link"
                      href={t.manual ? `/manuals/${t.manual.id}` : `/sources/${t.source.id}`}
                    >
                      {t.manual?.draft.title ?? t.source.title}
                    </Link>
                  </h2>
                  <p className="task-meta">
                    <span>
                      {t.source.kind === "file" ? "엑셀" : "텍스트"} · 버전 {t.source.revision}개
                    </span>
                    <Link href={`/sources/${t.source.id}`}>원본 보기</Link>
                    {t.manual?.provenance === "example" && <span>합성 예제</span>}
                  </p>
                </div>
                <span className={`task-status ${t.status.tone}`}>{t.status.label}</span>
                <Link
                  className={
                    t.action.primary ? "button task-action" : "button secondary task-action"
                  }
                  href={t.action.href}
                >
                  {t.action.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
