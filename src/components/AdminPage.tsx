"use client";
import { HTTPError } from "ky";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { http, kst, message } from "../lib/client";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  department: z.string().nullable(),
  createdAt: z.string(),
  admin: z.boolean(),
  adminSource: z.enum(["env", "db"]).nullable(),
  aiAllowed: z.boolean(),
  sources: z.number(),
  manuals: z.number(),
  published: z.number(),
  usage: z.object({ bytes: z.number(), limitBytes: z.number() }),
  customLimit: z.boolean(),
  aiToday: z.number(),
});
type AdminUser = z.infer<typeof userSchema>;
const usageSchema = z.object({
  days: z.array(z.object({ day: z.string(), total: z.number() })),
  dailyLimit: z.number(),
});
const eventSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  adminName: z.string().nullable(),
  targetName: z.string().nullable(),
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});
type AdminEvent = z.infer<typeof eventSchema>;
type Change = { admin?: boolean; aiAllowed?: boolean; storageLimitBytes?: number | null };

const MB = 1048576;
const mb = (bytes: number) => {
  const v = bytes / MB;
  return `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)} MB`;
};
const limitOptions = [
  { label: "기본 (100 MB)", value: null },
  { label: "200 MB", value: 200 * MB },
  { label: "500 MB", value: 500 * MB },
  { label: "1 GB", value: 1024 * MB },
];
function describe(e: AdminEvent) {
  const who = `${e.adminName ?? "삭제된 관리자"}가 ${e.targetName ?? "삭제된 사용자"}`;
  if (e.field === "admin") return `${who}${e.to ? "를 관리자로 지정" : "의 관리자 권한을 해제"}`;
  if (e.field === "aiAllowed") return `${who}의 AI 사용을 ${e.to ? "허용" : "차단"}`;
  const limit = (v: unknown) => (typeof v === "number" ? mb(v) : "기본(100 MB)");
  return `${who}의 용량 한도를 ${limit(e.from)} → ${limit(e.to)}`;
}

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<z.infer<typeof usageSchema> | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  // Demotion and AI blocking are confirmed inside the page, never with a browser dialog.
  const [confirm, setConfirm] = useState<{ user: AdminUser; change: Change } | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, a, e] = await Promise.all([
        http.get("/api/admin/users").json(),
        http.get("/api/admin/usage?days=14").json(),
        http.get("/api/admin/events?limit=20").json(),
      ]);
      setUsers(z.array(userSchema).parse(u));
      setUsage(usageSchema.parse(a));
      setEvents(z.array(eventSchema).parse(e));
      setState("ready");
    } catch (failure) {
      if (failure instanceof HTTPError && [401, 403].includes(failure.response.status))
        setState("forbidden");
      else {
        setError(await message(failure));
        setState("error");
      }
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(user: AdminUser, change: Change) {
    setBusy(true);
    setError("");
    setNotice("");
    setConfirm(null);
    try {
      const updated = userSchema.parse(
        await http.patch(`/api/admin/users/${user.id}`, { json: change }).json(),
      );
      setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));
      setEvents(z.array(eventSchema).parse(await http.get("/api/admin/events?limit=20").json()));
      setNotice(`${updated.name}의 권한을 바꿨습니다. 변경 기록에 남겼습니다.`);
    } catch (failure) {
      setError(await message(failure));
    } finally {
      setBusy(false);
    }
  }
  function request(user: AdminUser, change: Change) {
    if (change.admin === false || change.aiAllowed === false) setConfirm({ user, change });
    else void save(user, change);
  }

  if (state === "loading")
    return (
      <p className="loading" role="status">
        관리자 정보를 불러오고 있습니다.
      </p>
    );
  if (state === "forbidden")
    return (
      <section className="panel">
        <h1>관리자만 볼 수 있습니다</h1>
        <p className="muted">
          이 화면은 서비스 관리자에게만 열립니다. 권한이 필요하면 관리자에게 문의하세요.
        </p>
        <Link className="button" href="/manuals">
          내 문서함으로
        </Link>
      </section>
    );
  if (state === "error")
    return (
      <section className="panel">
        <h1>관리자</h1>
        <p className="error" role="alert">
          {error}
        </p>
        <button type="button" onClick={load}>
          다시 불러오기
        </button>
      </section>
    );

  const needle = query.trim().toLowerCase();
  const matched = users.filter((u) =>
    `${u.name} ${u.email} ${u.department ?? ""}`.toLowerCase().includes(needle),
  );
  // Rendering every row slows typing once there are thousands of accounts; search narrows the rest.
  const shown = matched.slice(0, 100);
  const today = usage?.days.at(-1)?.total ?? 0;
  const peak = Math.max(usage?.dailyLimit ?? 1, ...(usage?.days.map((d) => d.total) ?? [0]));
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">관리자</span>
          <h1>사용자와 사용량</h1>
          <p className="muted">
            사용자별 권한과 이용 현황을 봅니다. 다른 사람의 문서 제목과 내용은 보이지 않습니다.
          </p>
        </div>
      </div>
      <section className="admin-stats" aria-label="요약">
        <div>
          <span>가입자</span>
          <strong>{users.length}명</strong>
        </div>
        <div>
          <span>오늘 AI 호출</span>
          <strong>
            {today} / 하루 상한 {usage?.dailyLimit}
          </strong>
        </div>
        <div>
          <span>전체 원본 저장 용량</span>
          <strong>{mb(users.reduce((sum, u) => sum + u.usage.bytes, 0))}</strong>
        </div>
        <div>
          <span>게시된 매뉴얼</span>
          <strong>{users.reduce((sum, u) => sum + u.published, 0)}개</strong>
        </div>
      </section>
      {usage && (
        <section className="panel" aria-labelledby="usage-title">
          <h2 id="usage-title">최근 {usage.days.length}일 AI 호출</h2>
          <p className="help">질문·초안·후임자 답변 합계(UTC 날짜 기준) · 점선은 하루 상한</p>
          <div className="admin-chart">
            <span
              className="admin-chart-limit"
              aria-hidden="true"
              style={{ bottom: `${(usage.dailyLimit / peak) * 100}%` }}
            />
            {usage.days.map((d) => (
              <span
                key={d.day}
                className="admin-chart-bar"
                title={`${d.day}: ${d.total}회`}
                style={{ height: `${(d.total / peak) * 100}%` }}
              />
            ))}
          </div>
          <table className="visually-hidden">
            <caption>날짜별 AI 호출 수</caption>
            <tbody>
              {usage.days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{d.day}</th>
                  <td>{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section aria-labelledby="users-title">
        <div className="task-toolbar">
          <h2 id="users-title" className="admin-users-title">
            사용자 <span className="muted">{users.length}</span>
          </h2>
          <div className="task-search">
            <input
              type="search"
              aria-label="사용자 검색"
              placeholder="이름·이메일·부서로 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {confirm && (
          <section className="panel task-delete" aria-label="권한 변경 확인">
            <p>
              <strong>{confirm.user.name}</strong>
              {confirm.change.admin === false
                ? "의 관리자 권한을 해제할까요?"
                : "의 AI 기능을 차단할까요? 변경 질문 AI 보강, 매뉴얼 초안, 후임자 답변이 꺼집니다. 규칙 기반 질문과 직접 작성은 계속 됩니다."}
            </p>
            <div className="actions">
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => save(confirm.user, confirm.change)}
              >
                {confirm.change.admin === false ? "관리자 해제" : "AI 차단"}
              </button>
              <button type="button" className="secondary" onClick={() => setConfirm(null)}>
                취소
              </button>
            </div>
          </section>
        )}
        <div className="table-scroll admin-table">
          <table>
            <thead>
              <tr>
                <th scope="col">사용자</th>
                <th scope="col">업무 · 매뉴얼 · 게시</th>
                <th scope="col">저장 용량</th>
                <th scope="col">오늘 AI</th>
                <th scope="col">관리자</th>
                <th scope="col">AI 사용</th>
                <th scope="col">용량 한도</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const ratio = u.usage.bytes / u.usage.limitBytes;
                const locked = u.adminSource === "env";
                const current = u.customLimit ? u.usage.limitBytes : null;
                const options = limitOptions.some((o) => o.value === current)
                  ? limitOptions
                  : [...limitOptions, { label: mb(u.usage.limitBytes), value: current }];
                return (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      <div className="help">
                        {u.email} · {u.department ?? "부서 미입력"} ·{" "}
                        {kst(u.createdAt).slice(0, 10)} 가입
                      </div>
                    </td>
                    <td>
                      {u.sources} · {u.manuals} · {u.published}
                    </td>
                    <td>
                      <span className={ratio >= 0.9 ? "admin-near-text" : undefined}>
                        {mb(u.usage.bytes)} / {mb(u.usage.limitBytes)}
                      </span>
                      <span className="admin-meter" aria-hidden="true">
                        <span
                          className={ratio >= 0.9 ? "admin-near" : undefined}
                          style={{ width: `${Math.min(100, ratio * 100)}%` }}
                        />
                      </span>
                    </td>
                    <td>{u.aiToday}</td>
                    <td>
                      {locked ? (
                        <span className="badge">서버 설정 관리자</span>
                      ) : (
                        <label>
                          <input
                            type="checkbox"
                            checked={u.admin}
                            disabled={busy}
                            onChange={(e) => request(u, { admin: e.target.checked })}
                          />
                          <span className="visually-hidden">{u.name} </span>관리자
                        </label>
                      )}
                    </td>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          checked={u.aiAllowed}
                          disabled={busy}
                          onChange={(e) => request(u, { aiAllowed: e.target.checked })}
                        />
                        <span className="visually-hidden">{u.name} AI </span>
                        {u.aiAllowed ? "허용" : "차단됨"}
                      </label>
                    </td>
                    <td>
                      <select
                        aria-label={`${u.name} 용량 한도`}
                        value={current === null ? "" : String(current)}
                        disabled={busy}
                        onChange={(e) =>
                          request(u, {
                            storageLimitBytes: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      >
                        {options.map((o) => (
                          <option key={o.label} value={o.value === null ? "" : String(o.value)}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {matched.length === 0 && <p className="muted">조건에 맞는 사용자가 없습니다.</p>}
        {matched.length > shown.length && (
          <p className="help">
            {matched.length}명 중 최근 가입한 {shown.length}명만 보입니다. 검색으로 찾으세요.
          </p>
        )}
        <p className="help">
          권한을 바꾸면 바로 저장됩니다. 관리자 해제와 AI 차단은 한 번 더 확인합니다. 서버 설정
          관리자와 내 관리자 권한은 여기서 해제할 수 없습니다.
        </p>
      </section>
      <section className="panel" aria-labelledby="events-title">
        <h2 id="events-title">최근 변경 기록</h2>
        {events.length ? (
          <ul className="admin-events">
            {events.map((e) => (
              <li key={e.id}>
                <span className="help">{kst(e.createdAt)}</span> {describe(e)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">아직 변경 기록이 없습니다.</p>
        )}
      </section>
    </>
  );
}
