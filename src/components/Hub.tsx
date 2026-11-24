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
const overviewSchema = z.object({
  teams: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      role: z.enum(["admin", "member"]),
      leadReady: z.boolean(),
      lead: z.boolean(),
      memberCount: z.number(),
      current: z.boolean(),
      works: z.array(workSchema),
    }),
  ),
  personal: z.object({ id: z.uuid(), current: z.boolean(), works: z.array(workSchema) }).nullable(),
});
type Overview = z.infer<typeof overviewSchema>;
type Group = { id: string | null; works: Overview["teams"][number]["works"] };

const normalize = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");

// 내 문서함: 내가 속한 모든 팀의 업무와 상태를 한 화면에서 본다.
export function Hub() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const navigating = useRef(false);
  const mounted = useRef(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | "published">("all");
  useEffect(() => {
    let active = true;
    mounted.current = true;
    read("/api/overview", overviewSchema)
      .then((value) => {
        if (active) setOverview(value);
      })
      .catch(async (e) => {
        const detail = await message(e);
        if (active) setError(detail);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  if (!overview)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="loading" role="status">
        내 문서함을 불러오고 있습니다.
      </p>
    );
  // 다른 탭이 쿠키를 바꿀 수 있으므로 캐시된 current 대신 선택한 문서함을 맞춘다.
  const enter = (workspaceId: string | null, href: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    if (navigating.current) return;
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
  const all = [...overview.teams, ...(overview.personal ? [overview.personal] : [])].flatMap(
    (group) => group.works.map(taskState),
  );
  const shown = (group: Group) =>
    group.works
      .map((work) => ({ work, state: taskState(work) }))
      .filter(
        ({ work, state }) =>
          normalize(`${work.title} ${work.manualTitle ?? ""}`).includes(normalize(query)) &&
          (filter === "all" || (filter === "todo" ? state.todo : state.published)),
      );
  const rows = (group: Group) => {
    const visible = shown(group);
    if (!group.works.length) return <p className="muted">아직 올린 업무가 없습니다.</p>;
    if (!visible.length) return <p className="muted">조건에 맞는 업무가 없습니다.</p>;
    return (
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
                    aria-disabled={switching}
                    onClick={enter(group.id, home)}
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
                aria-disabled={switching}
                onClick={enter(group.id, state.action.href)}
              >
                {state.action.label}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  };
  const chips = [
    { id: "all", label: "전체", count: all.length },
    { id: "todo", label: "내가 할 일", count: all.filter((state) => state.todo).length },
    { id: "published", label: "게시됨", count: all.filter((state) => state.published).length },
  ] as const;
  const empty = !overview.teams.length && !overview.personal;
  return (
    <>
      <span className="eyebrow">한눈에 보기</span>
      <h1>내 문서함</h1>
      <p className="muted">
        내가 속한 팀의 업무와 매뉴얼을 한곳에서 봅니다. 팀 이름을 누르면 그 팀으로 들어갑니다.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {switching && <p role="status">문서함을 전환하고 있습니다.</p>}
      {empty ? (
        <section className="panel">
          <h2>팀 문서함을 만들어 시작하세요</h2>
          <p className="muted">팀을 만들어 함께 쓰거나 개인 문서함에 업무를 등록할 수 있습니다.</p>
          <div className="actions">
            <Link className="button" href="/teams">
              팀 만들기
            </Link>
            <Link
              className="button secondary"
              href="/sources/new"
              aria-disabled={switching}
              onClick={enter(null, "/sources/new")}
            >
              개인 문서함에 업무 등록
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div className="task-toolbar">
            <div className="task-search">
              <input
                type="search"
                aria-label="업무 검색"
                placeholder="업무·매뉴얼 이름으로 찾기"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <fieldset className="task-chips" aria-label="상태로 거르기">
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={filter === chip.id}
                  onClick={() => setFilter(chip.id)}
                >
                  {chip.label} {chip.count}
                </button>
              ))}
            </fieldset>
          </div>
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
                  <h2 id={`team-${team.id}`}>
                    <Link href={`/teams/${team.id}`}>{team.name}</Link>
                  </h2>
                  <span className="badge">{role}</span>
                  <span className="help">
                    팀원 {team.memberCount}명 · 업무 {team.works.length}개
                  </span>
                  <span className="actions">
                    <Link
                      className="button"
                      href="/sources/new"
                      aria-label={`${team.name}에 새 업무 등록`}
                      aria-disabled={switching}
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
                <h2 id="personal-works">개인 업무</h2>
                <span className="help">업무 {overview.personal.works.length}개</span>
              </div>
              <p className="help">
                개인 문서함에 보관한 업무입니다. 그대로 이용하거나, 필요하면 업무를 열어 팀
                문서함으로 옮길 수 있습니다.
              </p>
              {rows({ ...overview.personal, id: null })}
            </section>
          )}
          <div className="actions">
            <Link
              className="button secondary"
              href="/sources/new"
              aria-disabled={switching}
              onClick={enter(null, "/sources/new")}
            >
              개인 문서함에 업무 등록
            </Link>
            <Link className="button secondary" href="/teams">
              팀 만들기
            </Link>
          </div>
        </>
      )}
    </>
  );
}
