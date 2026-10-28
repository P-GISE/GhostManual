"use client";
import { HTTPError } from "ky";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { http, message } from "../lib/client";
import { requestDiagnostic } from "../lib/request-diagnostic";
import { RequestDiagnostics, useRequestDiagnostics } from "./RequestDiagnostics";

// Submit stays disabled until hydration so an early click is never lost or sent natively.
function useReady() {
  const mounted = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    mounted.current = true;
    setReady(true);
    return () => {
      mounted.current = false;
    };
  }, []);
  return { mounted, ready };
}

function ResendVerification({ email }: { readonly email: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");
  async function resend() {
    setState("busy");
    setError("");
    try {
      await http.post("/api/auth/verify/resend", { json: { email } });
      setState("sent");
    } catch (e) {
      setError(await message(e));
      setState("idle");
    }
  }
  return (
    <div>
      <button
        type="button"
        className="secondary"
        disabled={!email || state === "busy"}
        onClick={resend}
      >
        인증 메일 다시 보내기
      </button>
      {state === "sent" && <p role="status">인증 메일을 다시 보냈습니다.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleButton({ next }: { readonly next: string }) {
  return (
    <p>
      <a className="button secondary" href={`/api/auth/google?next=${encodeURIComponent(next)}`}>
        구글로 계속하기
      </a>
    </p>
  );
}

export function LoginForm({
  next,
  notice,
  google,
}: {
  readonly next: string;
  readonly notice: string | null;
  readonly google: boolean;
}) {
  const { record, reset } = useRequestDiagnostics();
  const { mounted, ready } = useReady();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [loggedIn, setLoggedIn] = useState<string | null>(null);
  async function verifySession(expiresAt: string) {
    setBusy(true);
    setError("");
    let status: number | undefined;
    try {
      const response = await http.get("/api/session", { cache: "no-store", timeout: 10000 });
      status = response.status;
      z.object({ role: z.literal("owner"), expiresAt: z.literal(expiresAt) }).parse(
        await response.json(),
      );
      if (mounted.current) {
        record(requestDiagnostic("session", undefined, status));
        router.push(next);
      }
    } catch (failure) {
      if (mounted.current) record(requestDiagnostic("session", failure, status));
      setError("로그인은 됐지만 이 브라우저에서 세션을 확인하지 못했습니다.");
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    reset();
    setBusy(true);
    setError("");
    setUnverified(false);
    let status: number | undefined;
    try {
      const response = await http.post("/api/auth/login", { json: { email, password } });
      status = response.status;
      const session = z.object({ expiresAt: z.iso.datetime() }).parse(await response.json());
      if (!mounted.current) return;
      record(requestDiagnostic("login", undefined, status));
      setLoggedIn(session.expiresAt);
      await verifySession(session.expiresAt);
    } catch (e) {
      if (mounted.current) record(requestDiagnostic("login", e, status));
      setUnverified(e instanceof HTTPError && e.response.status === 403);
      setError(await message(e));
      setBusy(false);
    }
  }
  return (
    <section className="prose">
      <span className="eyebrow">로그인</span>
      <h1>GhostManual 로그인</h1>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form method="post" onSubmit={submit}>
        <label htmlFor="login-email">이메일</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="login-password">비밀번호</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="actions">
          <button type="submit" disabled={!ready || busy || loggedIn !== null}>
            로그인
          </button>
        </div>
      </form>
      {busy && <p role="status">로그인하고 있습니다.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {unverified && <ResendVerification email={email} />}
      {google && <GoogleButton next={next} />}
      {loggedIn && error && (
        <div>
          <p className="help">
            연결 상태를 확인한 뒤 세션을 다시 확인하세요. 앱 안에서 연 경우 메뉴에서 Safari 또는
            Chrome으로 이 주소를 열고 다시 로그인해 주세요.
          </p>
          <button type="button" disabled={busy} onClick={() => verifySession(loggedIn)}>
            세션 다시 확인
          </button>
        </div>
      )}
      {error && <RequestDiagnostics />}
      <p className="help">
        계정이 없나요? <Link href="/signup">가입하기</Link>
      </p>
    </section>
  );
}

export function SignupForm({ google }: { readonly google: boolean }) {
  const { ready } = useReady();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await http.post("/api/auth/signup", { json: { name, email, password } });
      setSentTo(email);
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  if (sentTo)
    return (
      <section className="prose">
        <span className="eyebrow">가입</span>
        <h1>메일을 확인하세요</h1>
        <p role="status">인증 메일을 보냈습니다.</p>
        <p>
          {sentTo}의 받은편지함에서 링크를 열면 가입이 끝납니다. 링크는 24시간 동안 유효합니다.
          메일이 보이지 않으면 스팸함도 확인하세요.
        </p>
        <ResendVerification email={sentTo} />
      </section>
    );
  return (
    <section className="prose">
      <span className="eyebrow">가입</span>
      <h1>GhostManual 시작하기</h1>
      <p className="muted">이메일 인증을 마치면 나만의 문서함이 만들어집니다.</p>
      <form method="post" onSubmit={submit}>
        <label htmlFor="signup-name">이름</label>
        <input
          id="signup-name"
          autoComplete="name"
          required
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="signup-email">이메일</label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="signup-password">비밀번호</label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          aria-describedby="signup-password-help"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p id="signup-password-help" className="help">
          8자 이상. 비밀번호 찾기는 아직 없으니 잊지 않게 보관하세요.
        </p>
        <div className="actions">
          <button type="submit" disabled={!ready || busy}>
            가입하기
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {google && <GoogleButton next="/manuals" />}
      <p className="help">
        이미 계정이 있나요? <Link href="/login">로그인</Link>
      </p>
    </section>
  );
}
