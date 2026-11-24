"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { message, read } from "../lib/client";
import { taskState } from "../lib/task-state";
import { roleText, switchWorkspace } from "./Teams";

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
type Group = { id: string | null; current: boolean; works: Overview["teams"][number]["works"] };

const normalize = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");

// 내 문서함: 내가 속한 모든 팀의 업무와 상태를 한 화면에서 본다.
export function Hub() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | "published">("all");
  useEffect(() => {
    read("/api/overview", overviewSchema)
      .then(setOverview)
      .catch(async (e) => setError(await message(e)));
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
  // 업무·매뉴얼 화면은 세션의 문서함을 따른다. 다른 팀의 것을 누르면 그 팀으로 세션을 맞춘 뒤 연다.
  const enter = (group: Group, href: string) => (event: React.MouseEvent) => {
    if (group.current) return;
    event.preventDefault();
    setError("");
    void switchWorkspace(group.id, href).catch(async (e) => setError(await message(e)));
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
                  <Link className="task-link" href={home} onClick={enter(group, home)}>
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
                onClick={enter(group, state.action.href)}
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
      {empty ? (
        <section className="panel">
          <h2>팀 문서함을 만들어 시작하세요</h2>
          <p className="muted">
            업무는 팀 문서함에 올립니다. 혼자 쓰는 경우에도 팀을 하나 만들어 쓰면 됩니다.
          </p>
          <div className="actions">
            <Link className="button" href="/teams">
              팀 만들기
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
                      onClick={enter(team, "/sources/new")}
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
                <h2 id="personal-works">옮기지 않은 개인 업무</h2>
                <span className="help">업무 {overview.personal.works.length}개</span>
              </div>
              <p className="help">
                팀을 만들기 전에 올린 업무입니다. 업무를 열어 "팀 문서함으로 옮기기"로 팀에 옮길 수
                있습니다.
              </p>
              {rows({ ...overview.personal, id: null })}
            </section>
          )}
          <div className="actions">
            <Link className="button secondary" href="/teams">
              팀 만들기
            </Link>
          </div>
        </>
      )}
    </>
  );
}
