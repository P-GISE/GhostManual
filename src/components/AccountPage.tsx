"use client";
import { HTTPError } from "ky";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { fileSize, http, message } from "../lib/client";
import { workspacesSchema } from "./Teams";

const profileSchema = z.object({
  name: z.string(),
  email: z.string(),
  department: z.string().nullable(),
  loginMethods: z.array(z.enum(["password", "google"])),
  usage: z.object({ bytes: z.number(), limitBytes: z.number() }),
});
type Profile = z.infer<typeof profileSchema>;
const leadWorkspacesSchema = z.array(workspacesSchema.element.extend({ lead: z.boolean() }));
const leadTransferRequired = z.object({
  error: z.object({ code: z.literal("lead_transfer_required") }),
});
type LeadNotice =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; teams: { id: string; name: string }[] }
  | { phase: "failed"; detail: string };

const tabs = [
  { id: "profile", label: "내 프로필" },
  { id: "settings", label: "설정" },
] as const;

export function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("profile");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [leadNotice, setLeadNotice] = useState<LeadNotice>({ phase: "idle" });
  const active = useRef(true);
  const acting = useRef(false);
  const leadHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    active.current = true;
    http
      .get("/api/me", { cache: "no-store" })
      .json()
      .then((body) => {
        if (!active.current) return;
        const me = profileSchema.parse(body);
        setProfile(me);
        setName(me.name);
        setDepartment(me.department ?? "");
      })
      .catch(async (e) => {
        const detail = await message(e);
        if (active.current) setError(detail);
      });
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      !busy &&
      tab === "settings" &&
      leadNotice.phase !== "idle" &&
      leadNotice.phase !== "loading"
    )
      leadHeading.current?.focus();
  }, [busy, tab, leadNotice.phase]);
  async function run(action: () => Promise<void>) {
    if (acting.current || !active.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (e) {
      const detail = await message(e);
      if (active.current) setError(detail);
    } finally {
      acting.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function loadLeadTeams() {
    if (!active.current) return;
    setConfirmed(false);
    setLeadNotice({ phase: "loading" });
    try {
      const list = leadWorkspacesSchema.parse(
        await http.get("/api/workspaces", { cache: "no-store" }).json(),
      );
      if (!active.current) return;
      const teams = list.flatMap((team) =>
        team.lead && team.role === "admin" && team.name !== null
          ? [{ id: team.id, name: team.name }]
          : [],
      );
      setLeadNotice({ phase: "ready", teams });
    } catch (e) {
      const detail = await message(e);
      if (active.current) setLeadNotice({ phase: "failed", detail });
    }
  }
  const save = () =>
    run(async () => {
      const me = profileSchema.parse(
        await http
          .patch("/api/me", { json: { name: name.trim(), department: department.trim() || null } })
          .json(),
      );
      if (!active.current) return;
      setProfile(me);
      setStatus("저장했습니다. 새로 올리는 버전부터 바뀐 이름·소속이 기록됩니다.");
    });
  const resetMail = () =>
    run(async () => {
      if (!profile) return;
      await http.post("/api/auth/password-reset", { json: { email: profile.email } });
      if (!active.current) return;
      setStatus(
        `${profile.email}로 비밀번호 변경 링크를 보냈습니다. 링크는 1시간 동안 쓸 수 있습니다.`,
      );
    });
  const remove = () =>
    run(async () => {
      setLeadNotice({ phase: "idle" });
      try {
        await http.delete("/api/me");
        if (active.current) window.location.assign("/");
      } catch (e) {
        if (
          !(e instanceof HTTPError) ||
          e.response.status !== 409 ||
          !leadTransferRequired.safeParse(e.data).success
        )
          throw e;
        await loadLeadTeams();
      }
    });
  // Arrow keys move between tabs as in the WAI-ARIA tabs pattern.
  function onKey(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }
  const percent = profile ? Math.round((profile.usage.bytes / profile.usage.limitBytes) * 100) : 0;
  return (
    <section className="prose">
      <h1>계정</h1>
      <div role="tablist" aria-label="계정 메뉴" className="tabs">
        {tabs.map((t, index) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, index)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
      {!profile ? (
        !error && <p role="status">계정 정보를 불러오고 있습니다.</p>
      ) : tab === "profile" ? (
        <div id="panel-profile" role="tabpanel" aria-labelledby="tab-profile" className="panel">
          <label htmlFor="profile-name">이름</label>
          <input
            id="profile-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="profile-department">
            소속(부서) <span className="help">선택</span>
          </label>
          <input
            id="profile-department"
            value={department}
            maxLength={40}
            placeholder="예: 경영지원본부 회계파트"
            aria-describedby="department-help"
            onChange={(e) => setDepartment(e.target.value)}
          />
          <p id="department-help" className="help">
            버전 기록에 "이름 (소속)"으로 함께 남아 후임자가 누구에게 물어볼지 알 수 있습니다.
            바꿔도 이미 올린 버전의 이름·소속은 그대로입니다.
          </p>
          <div className="actions">
            <button type="button" disabled={busy || !name.trim()} onClick={save}>
              저장
            </button>
          </div>
          <h2>이메일</h2>
          <p>{profile.email}</p>
          <h2>로그인 방식</h2>
          <p>
            {profile.loginMethods.map((m) => (
              <span key={m} className="badge">
                {m === "password" ? "이메일·비밀번호" : "Google 연결됨"}
              </span>
            ))}
          </p>
        </div>
      ) : (
        <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
          <section className="panel">
            <h2>비밀번호 변경</h2>
            {profile.loginMethods.includes("password") ? (
              <>
                <p>{profile.email}으로 비밀번호 변경 링크를 보냅니다.</p>
                <button type="button" disabled={busy} onClick={resetMail}>
                  변경 메일 받기
                </button>
              </>
            ) : (
              <p className="help">
                Google로만 가입한 계정은 비밀번호가 없습니다. Google 계정에서 관리하세요.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>저장 공간</h2>
            <p>
              <strong>{fileSize(profile.usage.bytes)}</strong> 사용 중 ·{" "}
              {fileSize(profile.usage.limitBytes)} 중
            </p>
            <div
              className="meter"
              role="progressbar"
              aria-label="저장 공간 사용량"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="help">
              엑셀 원본 파일 기준, 파일 하나는 5 MB까지입니다. 가득 차면 오래된 자료를 지워야 새로
              올릴 수 있습니다. 자동으로 지우지 않습니다.
            </p>
          </section>
          <section className="panel">
            <h2>계정 삭제</h2>
            <p>
              계정과 원본, 엑셀 버전, 매뉴얼, 답변, 공유 권한을 모두 삭제합니다. 복구할 수 없습니다.
            </p>
            {leadNotice.phase !== "idle" && (
              <section
                className="notice"
                aria-label="대표 권한 이양 안내"
                aria-busy={leadNotice.phase === "loading"}
              >
                <h3 ref={leadHeading} tabIndex={-1}>
                  대표 권한을 먼저 이양해 주세요
                </h3>
                <p>아래 팀에서 대표 권한을 이양한 뒤 돌아와 삭제 내용을 다시 확인해 주세요.</p>
                {leadNotice.phase === "loading" && (
                  <p role="status">대표인 팀 목록을 확인하고 있습니다.</p>
                )}
                {leadNotice.phase === "failed" && (
                  <p className="error" role="alert">
                    {leadNotice.detail}
                  </p>
                )}
                {leadNotice.phase === "ready" &&
                  (leadNotice.teams.length ? (
                    <ul>
                      {leadNotice.teams.map((team) => (
                        <li key={team.id}>
                          <Link href={`/teams/${team.id}?tab=members`} prefetch={false}>
                            {team.name} 대표 이양
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>대표인 팀을 찾지 못했습니다. 팀 목록에서 현재 권한을 확인해 주세요.</p>
                  ))}
                <div className="actions">
                  <button type="button" disabled={busy} onClick={() => void run(loadLeadTeams)}>
                    대표 팀 다시 확인
                  </button>
                  <Link href="/teams" prefetch={false}>
                    팀 목록에서 확인
                  </Link>
                </div>
              </section>
            )}
            <label className="check">
              <input
                type="checkbox"
                disabled={busy}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              삭제할 내용을 확인했습니다.
            </label>
            <button
              type="button"
              className="secondary"
              disabled={!confirmed || busy}
              onClick={remove}
            >
              계정과 문서 영구 삭제
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
