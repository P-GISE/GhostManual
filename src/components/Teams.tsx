"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";

export const workspacesSchema = z.array(
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

// 지금 보고 있는 문서함의 이름. 팀 문서함이면 팀 이름, 아니면(또는 아직 모르면) "내 문서함".
export function useWorkspaceName() {
  const [name, setName] = useState("내 문서함");
  useEffect(() => {
    read("/api/workspaces", workspacesSchema)
      .then((list) => setName(list.find((workspace) => workspace.current)?.name ?? "내 문서함"))
      .catch(() => {});
  }, []);
  return name;
}

// 상단 메뉴의 문서함 전환. 속한 팀이 없으면 "팀 문서함" 링크만 보인다.
export function WorkspaceSwitch() {
  const [workspaces, setWorkspaces] = useState<z.infer<typeof workspacesSchema>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    read("/api/workspaces", workspacesSchema)
      .then(setWorkspaces)
      // 로그인하지 않았거나 공유 독자면 전환할 문서함이 없다.
      .catch(() => {});
  }, []);
  if (workspaces.length < 2) return null;
  return (
    <>
      <label className="workspace-switch">
        <span className="visually-hidden">문서함 전환</span>
        <select
          value={workspaces.find((workspace) => workspace.current)?.id ?? ""}
          disabled={busy}
          onChange={(event) => {
            setBusy(true);
            setError("");
            const personal = workspaces.find((workspace) => workspace.name === null)?.id;
            void switchWorkspace(event.target.value === personal ? null : event.target.value).catch(
              async (e) => {
                setError(await message(e));
                setBusy(false);
              },
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function TeamList() {
  const [workspaces, setWorkspaces] = useState<z.infer<typeof workspacesSchema> | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      // 새 팀으로 세션을 맞춘 뒤 연다. 팀 화면이 열리자마자 다시 불러오는 일을 피한다.
      await switchWorkspace(team.id, `/teams/${team.id}?created=1`);
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
