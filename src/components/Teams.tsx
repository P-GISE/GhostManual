"use client";
import { HTTPError } from "ky";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { http, message } from "../lib/client";

import { useCurrentWorkspace } from "./CurrentWorkspace";
export { useCurrentWorkspace, workspacesSchema } from "./CurrentWorkspace";

export const roleText = { admin: "팀 관리자", member: "팀원" } as const;
// 전환은 로그인 쿠키를 대상 문서함의 세션으로 바꾼다. 화면이 들고 있던 자료는 이전 문서함 것이므로 새로 연다.
export async function switchWorkspace(workspaceId: string | null, to = "/library") {
  await http.post("/api/session/workspace", { json: { workspaceId } });
  window.location.assign(to);
}

// 표시할 경로마다 이름을 다시 확인하고, 상단 경로가 없는 화면에서는 목록을 읽지 않는다.
export function WorkspaceCrumb() {
  const pathname = usePathname();
  if (!/^\/(sources|manuals|templates)\//.test(pathname)) return null;
  return <CurrentWorkspaceCrumb key={pathname} />;
}

function CurrentWorkspaceCrumb() {
  const current = useCurrentWorkspace();
  if (!current) return null;
  return (
    <p className="crumb">
      <span className="visually-hidden">현재 위치: </span>
      <Link href="/library">내 문서함</Link>
      <span aria-hidden="true"> › </span>
      {current.name === null ? (
        <span>개인 업무</span>
      ) : (
        <Link href={`/teams/${current.id}`}>{current.name}</Link>
      )}
    </p>
  );
}

// 팀 문서함 만들기. 만들면 그 팀으로 세션을 맞추고, 초대 안내가 나오는 팀 화면을 연다.
export function TeamCreate({
  heading = "팀 문서함 만들기",
  disabled = false,
  onBusyChange,
}: {
  readonly heading?: string;
  readonly disabled?: boolean;
  // 다른 문서함 전환이 먼저 시작됐으면 부모가 생성을 거절할 수 있다.
  readonly onBusyChange?: (busy: boolean) => boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  const attempted = useRef(false);
  const created = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function create() {
    if (
      !alive.current ||
      disabled ||
      pending.current ||
      (!created.current && (attempted.current || !name.trim()))
    )
      return;
    if (onBusyChange?.(true) === false) return;
    pending.current = true;
    setBusy(true);
    setError("");
    let navigated = false;
    try {
      if (!created.current) {
        attempted.current = true;
        const body = await http.post("/api/workspaces", { json: { name } }).json();
        if (!alive.current) return;
        const team = z.object({ id: z.uuid() }).parse(body);
        created.current = team.id;
        setCreatedId(team.id);
      }
      if (!alive.current) return;
      await http.post("/api/session/workspace", { json: { workspaceId: created.current } });
      if (!alive.current) return;
      window.location.assign(`/teams/${created.current}?created=1`);
      navigated = true;
    } catch (e) {
      if (!alive.current) return;
      const detail = await message(e);
      if (!alive.current) return;
      if (!created.current) {
        const rejected =
          e instanceof HTTPError &&
          e.response.status >= 400 &&
          e.response.status < 500 &&
          e.response.status !== 408;
        attempted.current = !rejected;
        setUncertain(!rejected);
      }
      setError(detail);
    } finally {
      if (alive.current && !navigated) {
        pending.current = false;
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  return (
    <section className="panel" aria-labelledby="team-create">
      <h2 id="team-create">{heading}</h2>
      <label htmlFor="team-name">팀 이름</label>
      <input
        id="team-name"
        value={name}
        maxLength={40}
        disabled={disabled || busy || uncertain || createdId !== null}
        onChange={(event) => setName(event.target.value)}
        aria-describedby="team-name-help"
      />
      <p id="team-name-help" className="help">
        업무는 팀 문서함에 올립니다. 혼자 쓰는 경우에도 팀을 하나 만들어 씁니다. 만든 사람이 팀
        관리자가 되고, 관리하는 팀은 5개까지 만들 수 있습니다.
      </p>
      {createdId && (
        <p className="help">
          팀은 만들어졌습니다. 이동에 실패하면 팀을 다시 만들지 않고 이동만 재시도합니다.
        </p>
      )}
      {uncertain && (
        <p className="help">
          팀 생성 결과를 확인하지 못했습니다. 다시 만들기 전에 내 문서함에서 팀 목록을 확인해
          주세요.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={disabled || busy || uncertain || (!createdId && !name.trim())}
          onClick={create}
        >
          {busy
            ? createdId
              ? "이동 중…"
              : "만드는 중…"
            : createdId
              ? "만든 팀으로 다시 이동"
              : "팀 문서함 만들기"}
        </button>
        {uncertain && <a href="/library">내 문서함에서 생성 결과 확인</a>}
      </div>
    </section>
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
        const { id } = z.object({ id: z.uuid() }).parse(body);
        await switchWorkspace(id, `/teams/${id}`);
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
