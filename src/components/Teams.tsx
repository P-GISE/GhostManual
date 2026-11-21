"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";

const workspacesSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    role: z.enum(["admin", "member"]).nullable(),
    current: z.boolean(),
  }),
);
export const roleText = { admin: "팀 관리자", member: "팀원" } as const;
// 전환은 로그인 쿠키를 대상 문서함의 세션으로 바꾼다. 화면이 들고 있던 자료는 이전 문서함 것이므로 새로 연다.
export async function switchWorkspace(workspaceId: string | null, to = "/manuals") {
  await http.post("/api/session/workspace", { json: { workspaceId } });
  window.location.assign(to);
}

// 상단 메뉴의 문서함 전환. 속한 팀이 없으면 "팀 문서함" 링크만 보인다.
export function WorkspaceSwitch() {
  const [workspaces, setWorkspaces] = useState<z.infer<typeof workspacesSchema>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    read("/api/workspaces", workspacesSchema)
      .then(setWorkspaces)
      // 로그인하지 않았거나 공유 독자면 전환할 문서함이 없다.
      .catch(() => {});
  }, []);
  if (workspaces.length < 2) return null;
  return (
    <label className="workspace-switch">
      <span className="visually-hidden">문서함 전환</span>
      <select
        value={workspaces.find((workspace) => workspace.current)?.id ?? ""}
        disabled={busy}
        onChange={(event) => {
          setBusy(true);
          const personal = workspaces.find((workspace) => workspace.name === null)?.id;
          void switchWorkspace(event.target.value === personal ? null : event.target.value).catch(
            () => setBusy(false),
          );
        }}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name ?? "내 문서함"}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TeamList() {
  const [workspaces, setWorkspaces] = useState<z.infer<typeof workspacesSchema> | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    read("/api/workspaces", workspacesSchema)
      .then(setWorkspaces)
      .catch(async (e) => setError(await message(e)));
  }, []);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const team = z
        .object({ id: z.uuid() })
        .parse(await http.post("/api/workspaces", { json: { name } }).json());
      router.push(`/teams/${team.id}`);
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  const teams = workspaces?.filter((workspace) => workspace.name !== null) ?? [];
  return (
    <>
      <span className="eyebrow">함께 쓰는 문서함</span>
      <h1>팀 문서함</h1>
      <p className="muted">
        팀 문서함의 업무와 매뉴얼은 팀에 남습니다. 사람이 떠나거나 계정을 지워도 사라지지 않고, 새로
        온 사람이 팀원으로 들어와 이어서 올립니다.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>팀 문서함 만들기</h2>
        <label htmlFor="team-name">팀 이름</label>
        <input
          id="team-name"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          aria-describedby="team-name-help"
        />
        <p id="team-name-help" className="help">
          만든 사람이 팀 관리자가 됩니다. 관리하는 팀은 5개까지 만들 수 있습니다.
        </p>
        <div className="actions">
          <button type="button" disabled={busy || !name.trim()} onClick={create}>
            {busy ? "만드는 중…" : "팀 문서함 만들기"}
          </button>
        </div>
      </section>
      <h2>내가 속한 팀</h2>
      {!workspaces ? (
        !error && (
          <p className="loading" role="status">
            팀 문서함을 불러오고 있습니다.
          </p>
        )
      ) : teams.length ? (
        <ul className="template-rows">
          {teams.map((team) => (
            <li key={team.id}>
              <Link href={`/teams/${team.id}`}>{team.name}</Link>{" "}
              <span className="badge">{team.role ? roleText[team.role] : ""}</span>{" "}
              {team.current ? (
                <span className="help">지금 보고 있는 문서함</span>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  aria-label={`${team.name} 문서함으로 전환`}
                  onClick={() =>
                    void switchWorkspace(team.id).catch(async (e) => setError(await message(e)))
                  }
                >
                  이 문서함으로 전환
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">속한 팀 문서함이 없습니다.</p>
      )}
    </>
  );
}

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
    }),
  ),
  invites: z.array(z.object({ id: z.uuid(), email: z.string(), expired: z.boolean() })),
});
type Team = z.infer<typeof teamSchema>;
export function TeamDetail({ id }: { readonly id: string }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [me, setMe] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [confirmName, setConfirmName] = useState("");
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
    load().catch(async (e) => setError(await message(e)));
    // 내 계정의 이름으로 목록에서 "나"를 찾는다. 나가기 버튼을 내 줄에만 두기 위해서다.
    read("/api/me", z.object({ id: z.uuid().optional(), name: z.string() }))
      .then((user) => setMe(user.id ?? ""))
      .catch(() => {});
  }, [load]);
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
  if (!team)
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
  const home = () => void switchWorkspace(null, "/teams");
  return (
    <>
      <Link href="/teams">팀 문서함 목록</Link>
      <h1>{team.name}</h1>
      <p>
        <span className="badge">{roleText[team.role]}</span>
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
      <section className="panel" aria-labelledby="members">
        <h2 id="members">팀원 {team.members.length}명</h2>
        <ul className="template-rows">
          {team.members.map((member) => (
            <li key={member.id}>
              <strong>{member.name}</strong>
              {member.id === me && <span className="help"> (나)</span>}{" "}
              <span className="badge">{roleText[member.role]}</span>{" "}
              <span className="help">
                {[member.department, member.email].filter(Boolean).join(" · ")}
              </span>
              <span className="actions">
                {admin && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    aria-label={`${member.name} ${member.role === "admin" ? "팀원으로 변경" : "팀 관리자로 지정"}`}
                    onClick={() =>
                      act(
                        () =>
                          http.patch(`/api/workspaces/${id}/members/${member.id}`, {
                            json: { role: member.role === "admin" ? "member" : "admin" },
                          }),
                        "역할을 바꿨습니다.",
                      )
                    }
                  >
                    {member.role === "admin" ? "팀원으로 변경" : "팀 관리자로 지정"}
                  </button>
                )}
                {member.id === me ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(() => http.delete(`/api/workspaces/${id}/members/${member.id}`), "", home)
                    }
                  >
                    팀 나가기
                  </button>
                ) : (
                  admin && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      aria-label={`${member.name} 내보내기`}
                      onClick={() =>
                        act(
                          () => http.delete(`/api/workspaces/${id}/members/${member.id}`),
                          `${member.name} 님을 내보냈습니다. 올린 자료는 팀에 남습니다.`,
                        )
                      }
                    >
                      내보내기
                    </button>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="help">
          나가거나 내보내도 그 사람이 올린 업무와 매뉴얼은 팀에 남습니다. 팀 관리자가 한 명뿐이면
          다른 관리자를 지정한 뒤에 나갈 수 있습니다.
        </p>
      </section>
      {admin && (
        <>
          <section className="panel" aria-labelledby="invite">
            <h2 id="invite">초대</h2>
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
              그 이메일 주소의 계정으로 로그인한 사람만 수락할 수 있습니다. 링크는 7일 동안
              유효합니다.
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
                  {team.invites.map((invite) => (
                    <li key={invite.id}>
                      {invite.email} {invite.expired && <span className="badge">만료됨</span>}
                      <span className="actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          aria-label={`${invite.email} 초대 취소`}
                          onClick={() =>
                            act(
                              () => http.delete(`/api/workspaces/${id}/invites/${invite.id}`),
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
          <hr />
          <h2>팀 문서함 삭제</h2>
          <p className="help">
            팀의 모든 업무·버전 기록·매뉴얼·공유 링크·양식이 영구 삭제되며 되돌릴 수 없습니다.
            확인을 위해 팀 이름 "{team.name}"을 그대로 입력하세요.
          </p>
          <label htmlFor="delete-team">삭제할 팀 이름</label>
          <input
            id="delete-team"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          <button
            type="button"
            className="secondary"
            disabled={busy || confirmName !== team.name}
            onClick={() =>
              act(
                () => http.delete(`/api/workspaces/${id}`, { json: { name: confirmName } }),
                "",
                home,
              )
            }
          >
            이 팀 문서함 삭제
          </button>
        </>
      )}
    </>
  );
}

// 초대 링크(/invite#토큰)로 들어온 화면. 로그인하지 않았으면 토큰을 잠시 맡겨 두고 로그인 뒤 돌아온다.
const INVITE_KEY = "gm-invite";
export function InviteAccept() {
  const [state, setState] = useState<"working" | "login" | "error">("working");
  const [error, setError] = useState("");
  useEffect(() => {
    let token = window.location.hash.slice(1);
    try {
      if (token) sessionStorage.setItem(INVITE_KEY, token);
      else token = sessionStorage.getItem(INVITE_KEY) ?? "";
    } catch {
      // 저장소를 쓸 수 없으면 주소의 토큰만 쓴다.
    }
    if (!token) {
      setError("초대 링크를 메일에서 다시 열어 주세요.");
      setState("error");
      return;
    }
    http
      .post("/api/invites/accept", { json: { token } })
      .json()
      .then(async (body) => {
        try {
          sessionStorage.removeItem(INVITE_KEY);
        } catch {
          // 지울 수 없어도 이미 쓴 초대라 다시 쓰이지 않는다.
        }
        await switchWorkspace(z.object({ id: z.uuid() }).parse(body).id);
      })
      .catch(async (e) => {
        const status =
          typeof e === "object" && e !== null && "response" in e
            ? z.object({ status: z.number() }).safeParse(e.response).data?.status
            : undefined;
        if (status === 401) setState("login");
        else {
          setError(await message(e));
          setState("error");
        }
      });
  }, []);
  return (
    <div className="prose">
      <span className="eyebrow">팀 문서함 초대</span>
      <h1>초대 수락</h1>
      {state === "working" && (
        <p className="loading" role="status">
          초대를 확인하고 있습니다.
        </p>
      )}
      {state === "login" && (
        <>
          <p>초대받은 이메일 주소의 계정으로 로그인하면 팀 문서함에 들어갑니다.</p>
          <div className="actions">
            <Link className="button" href="/login?next=%2Finvite">
              로그인
            </Link>
            <Link className="button secondary" href="/signup?next=%2Finvite">
              회원가입
            </Link>
          </div>
        </>
      )}
      {state === "error" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
