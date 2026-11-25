"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";
import { ManualList } from "./ManualList";
import { TeamProgress } from "./TeamProgress";
import { roleText, switchWorkspace, workspacesSchema } from "./Teams";
import { TemplateList } from "./TemplateList";

const teamSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(["admin", "member"]),
  members: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      department: z.string().nullable(),
      role: z.enum(["admin", "member"]),
      email: z.string().optional(),
      lead: z.boolean().optional(),
    }),
  ),
  // 대표 관리자가 정해진 팀인지(migration 014 적용 뒤). 거짓이면 예전처럼 admin 누구나 관리한다.
  leadReady: z.boolean().optional(),
  invites: z.array(z.object({ id: z.uuid(), email: z.string(), expired: z.boolean() })),
});
type Team = z.infer<typeof teamSchema>;

const tabs = [
  { id: "works", label: "업무" },
  { id: "members", label: "팀원·초대" },
  { id: "progress", label: "진행 현황" },
  { id: "forms", label: "양식" },
  { id: "settings", label: "팀 설정" },
] as const;
type TabId = (typeof tabs)[number]["id"];

// 팀 화면. 업무·팀원·양식·설정을 탭으로 묶는다. 주소의 ?tab= 으로 탭을, ?created=1 로 만든 직후 안내를 연다.
export function TeamPage({ id }: { readonly id: string }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [tab, setTab] = useState<TabId | null>(null);
  const [created, setCreated] = useState(false);
  // 업무·양식 목록과 새 업무 등록은 세션의 문서함을 따른다. 세션이 이 팀일 때만 그 탭을 그린다.
  const [aligned, setAligned] = useState(false);
  const [me, setMe] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [confirmName, setConfirmName] = useState("");
  // 관리자를 넘기려고 고른 팀원. 한 번 더 확인받는다.
  const [transfer, setTransfer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const load = useCallback(
    () =>
      read(`/api/workspaces/${id}/members`, teamSchema).then((current) => {
        setTeam(current);
        setName(current.name);
      }),
    [id],
  );
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setTab(tabs.find((entry) => entry.id === query.get("tab"))?.id ?? "works");
    setCreated(query.get("created") === "1");
    load()
      .then(() => read("/api/workspaces", workspacesSchema))
      .then((list) => {
        if (list.find((workspace) => workspace.current)?.id === id) setAligned(true);
        // 다른 문서함을 보다가 들어왔으면 이 팀으로 세션을 맞추고 같은 주소를 다시 연다.
        else return switchWorkspace(id, window.location.pathname + window.location.search);
      })
      .catch(async (e) => setError(await message(e)));
    // 내 계정의 id로 목록에서 "나"를 찾는다.
    read("/api/me", z.object({ id: z.uuid().optional(), name: z.string() }))
      .then((user) => setMe(user.id ?? ""))
      .catch(() => {});
  }, [load, id]);
  async function act(work: () => Promise<unknown>, done: string, after?: () => void) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await work();
      if (after) after();
      else {
        await load();
        setSaved(done);
      }
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(next: TabId) {
    setTab(next);
    setCreated(false);
    setSaved("");
    window.history.replaceState(null, "", `?tab=${next}`);
  }
  // 진행 현황은 관리자와 부관리자에게만 보이는 탭이다.
  const shown = tabs.filter((entry) => entry.id !== "progress" || team?.role === "admin");
  const active = shown.some((entry) => entry.id === tab) ? tab : "works";
  // 화살표 키로 탭을 옮긴다(WAI-ARIA 탭 패턴).
  function onKey(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next =
      shown[(index + (event.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length];
    if (!next) return;
    choose(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }
  if (!team || !tab)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="loading" role="status">
        팀 문서함을 불러오고 있습니다.
      </p>
    );
  const admin = team.role === "admin";
  const ready = team.leadReady === true;
  // 관리자(대표)만 역할 변경·넘기기·팀 삭제를 한다. 준비 전 팀에서는 admin이 모두 한다.
  const lead = ready ? team.members.some((member) => member.id === me && member.lead) : admin;
  const roleName = (member: { role: "admin" | "member"; lead?: boolean | undefined }) =>
    ready
      ? member.lead
        ? "관리자"
        : member.role === "admin"
          ? "부관리자"
          : "팀원"
      : roleText[member.role];
  const promote = ready ? "부관리자로 지정" : "팀 관리자로 지정";
  const home = () => window.location.assign("/teams");
  const waiting = (
    <p className="loading" role="status">
      이 팀 문서함으로 전환하고 있습니다.
    </p>
  );
  const invite = (
    <section className="panel" aria-labelledby="invite">
      <h2 id="invite">팀원 초대</h2>
      <label htmlFor="invite-email">초대할 사람의 이메일</label>
      <input
        id="invite-email"
        type="email"
        value={email}
        maxLength={254}
        onChange={(event) => setEmail(event.target.value)}
        aria-describedby="invite-help"
      />
      <p id="invite-help" className="help">
        그 이메일 주소의 계정으로 로그인한 사람만 수락할 수 있습니다. 링크는 7일 동안 유효합니다.
        후임자도 이렇게 초대합니다.
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={busy || !email.trim()}
          onClick={() =>
            act(
              () => http.post(`/api/workspaces/${id}/invites`, { json: { email } }),
              "초대 메일을 보냈습니다.",
            ).then(() => setEmail(""))
          }
        >
          초대 메일 보내기
        </button>
      </div>
      {team.invites.length > 0 && (
        <>
          <h3>수락을 기다리는 초대</h3>
          <ul className="template-rows">
            {team.invites.map((pending) => (
              <li key={pending.id}>
                {pending.email} {pending.expired && <span className="badge">만료됨</span>}
                <span className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    aria-label={`${pending.email} 초대 취소`}
                    onClick={() =>
                      act(
                        () => http.delete(`/api/workspaces/${id}/invites/${pending.id}`),
                        "초대를 취소했습니다.",
                      )
                    }
                  >
                    초대 취소
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
  return (
    <>
      <Link href="/teams">팀 문서함 목록</Link>
      <h1>{team.name}</h1>
      <p>
        <span className="badge">
          {roleName(team.members.find((member) => member.id === me) ?? { role: team.role })}
        </span>{" "}
        <span className="help">팀원 {team.members.length}명</span>
      </p>
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
      {created && admin ? (
        <>
          <p className="notice">
            <strong>{team.name} 문서함을 만들었습니다.</strong> 함께 쓸 사람을 초대하거나 첫 업무를
            올리세요. 혼자 써도 됩니다.
          </p>
          {invite}
          <section className="panel" aria-labelledby="first-work">
            <h2 id="first-work">첫 업무 올리기</h2>
            <p className="muted">
              평소 쓰던 업무 파일을 올리면 매뉴얼 초안을 만들 수 있습니다. 초대는 나중에 "팀원·초대"
              탭에서 언제든 더 할 수 있습니다.
            </p>
            {aligned ? (
              <div className="actions">
                <Link className="button" href="/sources/new">
                  새 업무 등록
                </Link>
                <button type="button" className="secondary" onClick={() => choose("forms")}>
                  양식 먼저 등록
                </button>
                <button type="button" className="secondary" onClick={() => choose("works")}>
                  팀 화면 보기
                </button>
              </div>
            ) : (
              waiting
            )}
          </section>
        </>
      ) : (
        <>
          <div role="tablist" aria-label={`${team.name} 메뉴`} className="tabs">
            {shown.map((entry, index) => (
              <button
                key={entry.id}
                id={`tab-${entry.id}`}
                type="button"
                role="tab"
                aria-selected={active === entry.id}
                aria-controls={`panel-${entry.id}`}
                tabIndex={active === entry.id ? 0 : -1}
                onClick={() => choose(entry.id)}
                onKeyDown={(event) => onKey(event, index)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`}>
            {active === "works" && (aligned ? <ManualList embedded /> : waiting)}
            {active === "forms" && (aligned ? <TemplateList embedded /> : waiting)}
            {active === "progress" && <TeamProgress id={id} />}
            {active === "members" && (
              <>
                {admin && invite}
                <section className="panel" aria-labelledby="members">
                  <h2 id="members">팀원 {team.members.length}명</h2>
                  <ul className="template-rows">
                    {team.members.map((member) => (
                      <li key={member.id}>
                        <strong>{member.name}</strong>
                        {member.id === me && <span className="help"> (나)</span>}{" "}
                        <span className="badge">{roleName(member)}</span>{" "}
                        <span className="help">
                          {[member.department, member.email].filter(Boolean).join(" · ")}
                        </span>
                        {transfer === member.id ? (
                          <span className="actions">
                            <span role="status">
                              {member.name} 님에게 관리자를 넘깁니다. 나는 부관리자가 됩니다.
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () =>
                                    http.post(`/api/workspaces/${id}/lead`, {
                                      json: { userId: member.id },
                                    }),
                                  `${member.name} 님에게 관리자를 넘겼습니다.`,
                                ).then(() => setTransfer(""))
                              }
                            >
                              넘기기 확인
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() => setTransfer("")}
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          admin && (
                            <span className="actions">
                              {/* 관리자 자신의 역할은 넘기기로만 바꾼다. */}
                              {lead && !member.lead && (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  aria-label={`${member.name} ${member.role === "admin" ? "팀원으로 변경" : promote}`}
                                  onClick={() =>
                                    act(
                                      () =>
                                        http.patch(`/api/workspaces/${id}/members/${member.id}`, {
                                          json: {
                                            role: member.role === "admin" ? "member" : "admin",
                                          },
                                        }),
                                      "역할을 바꿨습니다.",
                                    )
                                  }
                                >
                                  {member.role === "admin" ? "팀원으로 변경" : promote}
                                </button>
                              )}
                              {ready && lead && member.id !== me && (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  aria-label={`${member.name}에게 관리자 넘기기`}
                                  onClick={() => setTransfer(member.id)}
                                >
                                  관리자 넘기기
                                </button>
                              )}
                              {/* 부관리자는 팀원만 내보낸다. */}
                              {member.id !== me && (lead || member.role === "member") && (
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={busy}
                                  aria-label={`${member.name} 내보내기`}
                                  onClick={() =>
                                    act(
                                      () =>
                                        http.delete(`/api/workspaces/${id}/members/${member.id}`),
                                      `${member.name} 님을 내보냈습니다. 올린 자료는 팀에 남습니다.`,
                                    )
                                  }
                                >
                                  내보내기
                                </button>
                              )}
                            </span>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="help">
                    나가거나 내보내도 그 사람이 올린 업무와 매뉴얼은 팀에 남습니다.
                    {ready &&
                      " 관리자는 팀에 한 명이고, 부관리자 지정과 관리자 넘기기, 팀 삭제는 관리자만 합니다."}
                  </p>
                </section>
              </>
            )}
            {active === "settings" && (
              <>
                {admin && (
                  <section className="panel" aria-labelledby="rename">
                    <h2 id="rename">팀 이름</h2>
                    <label htmlFor="rename-team">팀 이름 바꾸기</label>
                    <input
                      id="rename-team"
                      value={name}
                      maxLength={40}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !name.trim() || name.trim() === team.name}
                        onClick={() =>
                          act(
                            () => http.patch(`/api/workspaces/${id}`, { json: { name } }),
                            "팀 이름을 바꿨습니다.",
                          )
                        }
                      >
                        이름 저장
                      </button>
                    </div>
                  </section>
                )}
                <section className="panel" aria-labelledby="leave">
                  <h2 id="leave">팀 나가기</h2>
                  <p className="help">
                    나가도 내가 올린 업무와 매뉴얼은 팀에 남습니다.{" "}
                    {ready
                      ? lead &&
                        "관리자는 팀원·초대 탭에서 다른 사람에게 관리자를 넘긴 뒤에 나갈 수 있습니다."
                      : "팀 관리자가 한 명뿐이면 다른 관리자를 지정한 뒤에 나갈 수 있습니다."}
                  </p>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy || !me || (ready && lead)}
                      onClick={() =>
                        act(() => http.delete(`/api/workspaces/${id}/members/${me}`), "", home)
                      }
                    >
                      팀 나가기
                    </button>
                  </div>
                </section>
                {lead && (
                  <section className="panel" aria-labelledby="delete">
                    <h2 id="delete">팀 문서함 삭제</h2>
                    <p className="help">
                      팀의 모든 업무·버전 기록·매뉴얼·공유 링크·양식이 영구 삭제되며 되돌릴 수
                      없습니다. 확인을 위해 팀 이름 "{team.name}"을 그대로 입력하세요.
                    </p>
                    <label htmlFor="delete-team">삭제할 팀 이름</label>
                    <input
                      id="delete-team"
                      value={confirmName}
                      onChange={(event) => setConfirmName(event.target.value)}
                    />
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || confirmName !== team.name}
                        onClick={() =>
                          act(
                            () =>
                              http.delete(`/api/workspaces/${id}`, { json: { name: confirmName } }),
                            "",
                            home,
                          )
                        }
                      >
                        이 팀 문서함 삭제
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
