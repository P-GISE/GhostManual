"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";
import { taskState } from "../lib/task-state";
import { roleText } from "./Teams";

const workSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  manualTitle: z.string().nullable(),
  kind: z.enum(["text", "file"]),
  fileType: z.string().nullable(),
  provenance: z.string().nullable(),
  revision: z.number(),
  createdByName: z.string().nullable(),
  openQuestions: z.number(),
  manualId: z.uuid().nullable(),
  publishedVersion: z.number().nullable(),
  needsReview: z.boolean(),
  unpublishedChanges: z.boolean(),
});
const pageFields = {
  workCount: z.number().int().nonnegative(),
  matchingCount: z.number().int().nonnegative(),
  nextWorkCursor: z.string().nullable(),
};
const overviewSchema = z.object({
  teams: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        role: z.enum(["admin", "member"]),
        leadReady: z.boolean(),
        lead: z.boolean(),
        memberCount: z.number(),
        current: z.boolean(),
        ...pageFields,
        works: z.array(workSchema).max(10),
      }),
    )
    .max(20),
  personal: z
    .object({
      id: z.uuid(),
      current: z.boolean(),
      ...pageFields,
      works: z.array(workSchema).max(10),
    })
    .nullable(),
  counts: z.object({ all: z.number(), todo: z.number(), published: z.number() }),
  nextTeamCursor: z.string().nullable(),
});
type Overview = z.infer<typeof overviewSchema>;
type Group = Pick<
  Overview["teams"][number],
  "id" | "works" | "workCount" | "matchingCount" | "nextWorkCursor"
>;

// 서버에서 전체 검색 후 제한된 페이지를 받는다. 이전 검색 응답은 현재 화면을 덮지 않는다.
export function Hub() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const navigating = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const paging = useRef(false);
  const focusTarget = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | "published">("all");
  const [teamCursor, setTeamCursor] = useState<string | null>(null);
  const [back, setBack] = useState<(string | null)[]>([]);
  const [workCursors, setWorkCursors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const [reload, setReload] = useState(0);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [retryWork, setRetryWork] = useState<{ id: string; cursor: string | null } | null>(null);
  const key = JSON.stringify([query, filter, teamCursor, reload]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const version = ++generation.current;
    paging.current = true;
    setLoading(true);
    setFailed(false);
    setError("");
    setPendingGroup(null);
    setRetryWork(null);
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ query, filter });
        if (teamCursor) params.set("afterTeam", teamCursor);
        void read(`/api/overview?${params}`, overviewSchema)
          .then((value) => {
            if (!active || version !== generation.current) return;
            setOverview(value);
            setLoadedKey(key);
            setWorkCursors({});
            setLoading(false);
            paging.current = false;
          })
          .catch(async (e) => {
            const detail = await message(e);
            if (!active || version !== generation.current) return;
            setError(detail);
            setFailed(true);
            setLoading(false);
            paging.current = false;
          });
      },
      query ? 300 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, filter, teamCursor, key]);
  useEffect(() => {
    if (!loading && !pendingGroup && focusTarget.current) {
      const target =
        document.getElementById(focusTarget.current) ?? document.getElementById("overview-title");
      focusTarget.current = null;
      target?.focus();
    }
  }, [loading, pendingGroup]);
  const resetSearch = () => {
    focusTarget.current = null;
    generation.current++;
    paging.current = true;
    setLoading(true);
    setTeamCursor(null);
    setBack([]);
  };
  const changeTeam = (cursor: string | null, previous = false) => {
    if (paging.current || navigating.current) return;
    generation.current++;
    paging.current = true;
    setLoading(true);
    focusTarget.current = "overview-title";
    setBack(previous ? back.slice(0, -1) : [...back, teamCursor]);
    setTeamCursor(cursor);
  };
  const loadWork = async (id: string, cursor: string | null) => {
    if (paging.current || navigating.current) return;
    paging.current = true;
    const version = ++generation.current;
    focusTarget.current = overview?.personal?.id === id ? "personal-works" : `team-${id}`;
    setPendingGroup(id);
    setRetryWork(null);
    setError("");
    const params = new URLSearchParams({ query, filter, workspaceId: id });
    if (cursor) params.set("afterWork", cursor);
    try {
      const value = await read(`/api/overview?${params}`, overviewSchema);
      if (!mounted.current || version !== generation.current) return;
      setOverview(
        (current) =>
          current && {
            ...current,
            counts: value.counts,
            teams: current.teams.map((team) =>
              team.id === id ? (value.teams.find((item) => item.id === id) ?? team) : team,
            ),
            personal: current.personal?.id === id ? value.personal : current.personal,
          },
      );
      setWorkCursors((current) => ({ ...current, [id]: cursor }));
    } catch (e) {
      const detail = await message(e);
      if (!mounted.current || version !== generation.current) return;
      setError(detail);
      setRetryWork({ id, cursor });
    } finally {
      if (mounted.current && version === generation.current) {
        paging.current = false;
        setPendingGroup(null);
      }
    }
  };
  const busy = switching || loading || pendingGroup !== null;
  // 다른 탭이 쿠키를 바꿀 수 있으므로 캐시된 current 대신 선택한 문서함을 맞춘다.
  const enter = (workspaceId: string | null, href: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    if (navigating.current || paging.current || failed || loadedKey !== key) return;
    navigating.current = true;
    setSwitching(true);
    setError("");
    void http
      .post("/api/session/workspace", { json: { workspaceId } })
      .then(() => {
        if (mounted.current) window.location.assign(href);
      })
      .catch(async (e) => {
        const detail = await message(e);
        if (!mounted.current) return;
        navigating.current = false;
        setSwitching(false);
        setError(detail);
      });
  };
  const rows = (group: Group, personal = false) => {
    const visible = group.works.map((work) => ({ work, state: taskState(work) }));
    return (
      <>
        {!group.works.length && (
          <p className="muted">
            {group.workCount ? "조건에 맞는 업무가 없습니다." : "아직 올린 업무가 없습니다."}
          </p>
        )}
        <ul className="task-list">
          {visible.map(({ work, state }) => {
            const home = work.manualId ? `/manuals/${work.manualId}` : `/sources/${work.id}`;
            return (
              <li key={work.id} className="task-card">
                <span className={`task-icon ${work.kind}`} aria-hidden="true">
                  {work.kind === "file" ? (work.fileType ?? "xlsx").toUpperCase() : "TXT"}
                </span>
                <div className="task-main">
                  <h3>
                    <Link
                      className="task-link"
                      href={home}
                      aria-disabled={busy}
                      onClick={enter(personal ? null : group.id, home)}
                    >
                      {work.manualTitle ?? work.title}
                    </Link>
                  </h3>
                  <p className="task-meta">
                    <span>버전 {work.revision}개</span>
                    {work.createdByName && <span>올린 사람 {work.createdByName}</span>}
                    {work.provenance === "example" && <span>합성 예제</span>}
                  </p>
                </div>
                <span className={`task-status ${state.status.tone}`}>{state.status.label}</span>
                <Link
                  className={
                    state.action.primary ? "button task-action" : "button secondary task-action"
                  }
                  href={state.action.href}
                  aria-disabled={busy}
                  onClick={enter(personal ? null : group.id, state.action.href)}
                >
                  {state.action.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {(group.matchingCount > 10 || workCursors[group.id]) && (
          <div className="actions">
            <span className="help">
              검색 결과 {group.matchingCount}개 · 현재 {group.works.length}개 표시
            </span>
            <button
              type="button"
              className="secondary"
              disabled={busy || !workCursors[group.id]}
              onClick={() => {
                void loadWork(group.id, null);
              }}
            >
              처음 업무
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !group.nextWorkCursor}
              onClick={() => {
                void loadWork(group.id, group.nextWorkCursor);
              }}
            >
              다음 업무
            </button>
          </div>
        )}
      </>
    );
  };
  const chips = [
    { id: "all", label: "전체", count: overview?.counts.all ?? 0 },
    { id: "todo", label: "내가 할 일", count: overview?.counts.todo ?? 0 },
    { id: "published", label: "게시됨", count: overview?.counts.published ?? 0 },
  ] as const;
  const empty =
    overview &&
    !overview.teams.length &&
    !overview.personal &&
    !query.trim() &&
    filter === "all" &&
    !teamCursor;
  return (
    <>
      <span className="eyebrow">한눈에 보기</span>
      <h1 id="overview-title" tabIndex={-1}>
        내 문서함
      </h1>
      <p className="muted">
        내가 속한 팀의 업무와 매뉴얼을 한곳에서 봅니다. 팀 이름을 누르면 그 팀으로 들어갑니다.
      </p>
      <div className="task-toolbar">
        <div className="task-search">
          <input
            type="search"
            maxLength={100}
            disabled={switching}
            aria-label="업무 검색"
            placeholder="업무·매뉴얼 이름으로 찾기"
            value={query}
            onChange={(event) => {
              resetSearch();
              setQuery(event.target.value);
            }}
          />
        </div>
        <fieldset className="task-chips" aria-label="상태로 거르기">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={filter === chip.id}
              disabled={switching}
              onClick={() => {
                if (filter !== chip.id) {
                  resetSearch();
                  setFilter(chip.id);
                }
              }}
            >
              {chip.label} {chip.count}
            </button>
          ))}
        </fieldset>
      </div>
      {loading && (
        <p className="loading" role="status">
          내 문서함을 불러오고 있습니다.
        </p>
      )}
      {pendingGroup && <p role="status">업무 페이지를 불러오고 있습니다.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {switching && <p role="status">문서함을 전환하고 있습니다.</p>}
      {(failed || retryWork) && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (retryWork) {
              void loadWork(retryWork.id, retryWork.cursor);
            } else {
              setLoading(true);
              setReload((value) => value + 1);
            }
          }}
        >
          다시 불러오기
        </button>
      )}
      {!loading &&
        !failed &&
        loadedKey === key &&
        overview &&
        (empty ? (
          <section className="panel">
            <h2>팀 문서함을 만들어 시작하세요</h2>
            <p className="muted">
              팀을 만들어 함께 쓰거나 개인 문서함에 업무를 등록할 수 있습니다.
            </p>
            <div className="actions">
              <Link className="button" href="/teams">
                팀 만들기
              </Link>
              <Link
                className="button secondary"
                href="/sources/new"
                aria-disabled={busy}
                onClick={enter(null, "/sources/new")}
              >
                개인 문서함에 업무 등록
              </Link>
            </div>
          </section>
        ) : (
          <>
            {!overview.teams.length && !overview.personal && (
              <p className="muted">조건에 맞는 업무가 없습니다.</p>
            )}
            {overview.teams.map((team) => {
              const role = team.leadReady
                ? team.lead
                  ? "관리자"
                  : team.role === "admin"
                    ? "부관리자"
                    : "팀원"
                : roleText[team.role];
              return (
                <section key={team.id} className="hub-team" aria-labelledby={`team-${team.id}`}>
                  <div className="hub-team-head">
                    <h2 id={`team-${team.id}`} tabIndex={-1}>
                      <Link href={`/teams/${team.id}`}>{team.name}</Link>
                    </h2>
                    <span className="badge">{role}</span>
                    <span className="help">
                      팀원 {team.memberCount}명 · 업무 {team.workCount}개
                    </span>
                    <span className="actions">
                      <Link
                        className="button"
                        href="/sources/new"
                        aria-label={`${team.name}에 새 업무 등록`}
                        aria-disabled={busy}
                        onClick={enter(team.id, "/sources/new")}
                      >
                        새 업무 등록
                      </Link>
                      {team.role === "admin" && (
                        <Link
                          className="button secondary"
                          href={`/teams/${team.id}?tab=members`}
                          aria-label={`${team.name} 팀원 초대`}
                        >
                          팀원 초대
                        </Link>
                      )}
                      <Link
                        className="button secondary"
                        href={`/teams/${team.id}`}
                        aria-label={`${team.name} 팀 화면 열기`}
                      >
                        팀 화면 열기
                      </Link>
                    </span>
                  </div>
                  {rows(team)}
                </section>
              );
            })}
            {overview.personal && (
              <section className="hub-team" aria-labelledby="personal-works">
                <div className="hub-team-head">
                  <h2 id="personal-works" tabIndex={-1}>
                    개인 업무
                  </h2>
                  <span className="help">업무 {overview.personal.workCount}개</span>
                </div>
                <p className="help">
                  개인 문서함에 보관한 업무입니다. 그대로 이용하거나, 필요하면 업무를 열어 팀
                  문서함으로 옮길 수 있습니다.
                </p>
                {rows(overview.personal, true)}
              </section>
            )}
            {(back.length > 0 || overview.nextTeamCursor) && (
              <nav className="actions" aria-label="문서함 페이지">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !back.length}
                  onClick={() => changeTeam(back.at(-1) ?? null, true)}
                >
                  이전 문서함
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !overview.nextTeamCursor}
                  onClick={() => changeTeam(overview.nextTeamCursor)}
                >
                  다음 문서함
                </button>
              </nav>
            )}
            <div className="actions">
              <Link
                className="button secondary"
                href="/sources/new"
                aria-disabled={busy}
                onClick={enter(null, "/sources/new")}
              >
                개인 문서함에 업무 등록
              </Link>
              <Link className="button secondary" href="/teams">
                팀 만들기
              </Link>
            </div>
          </>
        ))}
    </>
  );
}
