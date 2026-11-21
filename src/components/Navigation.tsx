"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http } from "../lib/client";
import { CHAT_STORAGE_PREFIX } from "./QuestionForm";
import { WorkspaceSwitch } from "./Teams";

// Remounted per path (key) so the name refreshes after login or logout.
function AccountMenu() {
  const [name, setName] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  useEffect(() => {
    let active = true;
    http
      .get("/api/me", { cache: "no-store" })
      .json()
      .then((body) => {
        const user = z.object({ name: z.string(), admin: z.boolean().optional() }).safeParse(body);
        if (!active) return;
        setName(user.success ? user.data.name : null);
        setAdmin(user.success && user.data.admin === true);
      })
      .catch(() => {
        if (active) setName(null);
      });
    return () => {
      active = false;
    };
  }, []);
  async function logout() {
    setBusy(true);
    setLogoutFailed(false);
    try {
      await http.post("/api/auth/logout");
    } catch {
      setLogoutFailed(true);
      setBusy(false);
      return;
    }
    // 로그아웃하면 이 브라우저에 기억해 둔 대화(질문 id)도 지운다.
    try {
      for (const key of Object.keys(localStorage))
        if (key.startsWith(CHAT_STORAGE_PREFIX)) localStorage.removeItem(key);
    } catch {
      // 저장소를 쓸 수 없으면 지울 것도 없다.
    }
    window.location.assign("/");
  }
  return name ? (
    <span className="account">
      {admin && <Link href="/admin">관리자</Link>}
      <Link className="account-name" href="/account">
        {name}
      </Link>
      <button type="button" className="secondary" disabled={busy} onClick={logout}>
        로그아웃
      </button>
      {logoutFailed && <span role="alert">로그아웃하지 못했습니다. 다시 시도해 주세요.</span>}
    </span>
  ) : (
    <Link href="/login">로그인</Link>
  );
}
export function Navigation() {
  const pathname = usePathname();
  const reader = pathname === "/share";
  return (
    <header className="shell-header">
      <Link className="brand" href={reader ? "/share" : "/"}>
        GhostManual<span>업무를 남기는 문서함</span>
      </Link>
      {reader ? (
        <span className="badge">읽기·질문 전용 공유</span>
      ) : (
        <nav aria-label="주 메뉴">
          {[
            { href: "/manuals", label: "문서함" },
            { href: "/sources/new", label: "자료 등록" },
            { href: "/templates", label: "양식" },
            { href: "/teams", label: "팀" },
            { href: "/help", label: "도움말" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              data-active={
                href === "/manuals" || href === "/templates" || href === "/teams"
                  ? pathname.startsWith(href)
                  : pathname === href
              }
            >
              {label}
            </Link>
          ))}
          <WorkspaceSwitch />
          <AccountMenu key={pathname} />
        </nav>
      )}
    </header>
  );
}
