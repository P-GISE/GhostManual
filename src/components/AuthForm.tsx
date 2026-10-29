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

// Keeps a destination (such as a shared manual) when moving between login and signup.
function withNext(path: string, next: string) {
  return next === "/manuals" ? path : `${path}?next=${encodeURIComponent(next)}`;
}

function ResendVerification({ email, next }: { readonly email: string; readonly next: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");
  async function resend() {
    setState("busy");
    setError("");
    try {
      await http.post("/api/auth/verify/resend", { json: { email, next } });
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

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  minLength,
  describedBy,
}: {
  readonly id: string;
  readonly label: string;
  readonly autoComplete: "current-password" | "new-password";
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly minLength?: number;
  readonly describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={128}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={`${label} ${visible ? "숨기기" : "보기"}`}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </div>
    </>
  );
}

// Follows Google's sign-in button branding: white surface, gray outline, multicolor G.
function GoogleButton({ next, divider }: { readonly next: string; readonly divider: string }) {
  return (
    <>
      <a className="google-button" href={`/api/auth/google?next=${encodeURIComponent(next)}`}>
        <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
        Google 계정으로 계속하기
      </a>
      <p className="auth-divider">
        <span>또는 {divider}</span>
      </p>
    </>
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
      const session = z
        .object({
          role: z.literal("owner"),
          expiresAt: z.literal(expiresAt),
          termsRequired: z.boolean().optional(),
        })
        .parse(await response.json());
      if (mounted.current) {
        record(requestDiagnostic("session", undefined, status));
        router.push(session.termsRequired ? withNext("/welcome", next) : next);
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
      {google && <GoogleButton next={next} divider="이메일로 로그인" />}
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
        <PasswordField
          id="login-password"
          label="비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
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
      {unverified && <ResendVerification email={email} next={next} />}
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
        <Link href="/forgot-password">비밀번호를 잊으셨나요?</Link>
      </p>
      <p className="help">
        계정이 없나요? <Link href={withNext("/signup", next)}>가입하기</Link>
      </p>
    </section>
  );
}

export function SignupForm({ google, next }: { readonly google: boolean; readonly next: string }) {
  const { ready } = useReady();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("비밀번호가 서로 다릅니다. 두 칸에 같은 비밀번호를 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await http.post("/api/auth/signup", { json: { name, email, password, next, agreed } });
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
        <ResendVerification email={sentTo} next={next} />
      </section>
    );
  return (
    <section className="prose">
      <span className="eyebrow">가입</span>
      <h1>GhostManual 시작하기</h1>
      <p className="muted">
        {google
          ? "Google 계정으로 바로 시작하거나, 이메일로 가입하세요. 이메일 가입은 인증 메일을 거칩니다."
          : "이메일 인증을 마치면 나만의 문서함이 만들어집니다."}
      </p>
      {google && <GoogleButton next={next} divider="이메일로 가입" />}
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
        <PasswordField
          id="signup-password"
          label="비밀번호"
          autoComplete="new-password"
          minLength={8}
          describedBy="signup-password-help"
          value={password}
          onChange={setPassword}
        />
        <p id="signup-password-help" className="help">
          8자 이상으로 입력하세요.
        </p>
        <PasswordField
          id="signup-password-confirm"
          label="비밀번호 확인"
          autoComplete="new-password"
          minLength={8}
          value={confirm}
          onChange={setConfirm}
        />
        <TermsConsent checked={agreed} onChange={setAgreed} />
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
      <p className="help">
        이미 계정이 있나요? <Link href={withNext("/login", next)}>로그인</Link>
      </p>
    </section>
  );
}

export function ForgotPasswordForm() {
  const { ready } = useReady();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await http.post("/api/auth/password-reset", { json: { email } });
      setSent(true);
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="prose">
      <span className="eyebrow">비밀번호 찾기</span>
      <h1>비밀번호 재설정</h1>
      {sent ? (
        <p role="status">
          재설정 메일을 보냈습니다. 가입한 이메일이라면 1시간 동안 쓸 수 있는 링크가 도착합니다.
          메일이 보이지 않으면 스팸함도 확인하세요.
        </p>
      ) : (
        <>
          <p className="muted">
            가입한 이메일을 입력하면 비밀번호를 다시 정하는 링크를 보내 드립니다.
          </p>
          <form method="post" onSubmit={submit}>
            <label htmlFor="forgot-email">이메일</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="actions">
              <button type="submit" disabled={!ready || busy}>
                재설정 메일 받기
              </button>
            </div>
          </form>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="help">
        <Link href="/login">로그인 화면으로</Link>
      </p>
    </section>
  );
}

export function ResetPasswordForm() {
  const { ready } = useReady();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The token travels in the fragment so it never reaches server logs or Referer headers.
  useEffect(() => {
    setToken(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("비밀번호가 서로 다릅니다. 두 칸에 같은 비밀번호를 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await http.post("/api/auth/password-reset/confirm", { json: { token, password } });
      window.location.assign("/login?notice=password_reset");
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  return (
    <section className="prose">
      <span className="eyebrow">비밀번호 찾기</span>
      <h1>새 비밀번호 정하기</h1>
      <p className="muted">비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다.</p>
      <form method="post" onSubmit={submit}>
        <PasswordField
          id="reset-password"
          label="새 비밀번호"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        <PasswordField
          id="reset-password-confirm"
          label="새 비밀번호 확인"
          autoComplete="new-password"
          minLength={8}
          value={confirm}
          onChange={setConfirm}
        />
        <div className="actions">
          <button type="submit" disabled={!ready || busy || !token}>
            비밀번호 바꾸기
          </button>
        </div>
      </form>
      {ready && !token && (
        <p className="error" role="alert">
          재설정 링크가 올바르지 않습니다. 메일의 링크를 다시 열거나 새 메일을 받아 주세요.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="help">
        <Link href="/forgot-password">재설정 메일 다시 받기</Link>
      </p>
    </section>
  );
}

function TermsConsent({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        이용약관과 개인정보 안내에 동의합니다.
      </label>
      <p className="help">
        <Link href="/terms" target="_blank">
          이용약관
        </Link>{" "}
        ·{" "}
        <Link href="/privacy" target="_blank">
          개인정보 안내
        </Link>{" "}
        (새 탭)
      </p>
    </>
  );
}

// First Google sign-in lands here: the account exists but cannot be used until the terms are agreed.
export function WelcomeForm({ next }: { readonly next: string }) {
  const { ready } = useReady();
  const [user, setUser] = useState<{ name: string; email: string; newAccount: boolean } | null>(
    null,
  );
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    http
      .get("/api/me", { cache: "no-store" })
      .json()
      .then((body) =>
        setUser(
          z.object({ name: z.string(), email: z.string(), newAccount: z.boolean() }).parse(body),
        ),
      )
      .catch(async (e) => setError(await message(e)));
  }, []);
  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await http.post("/api/auth/terms");
      window.location.assign(next);
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  // Only a just-created account is deleted; an older one keeps its documents and just logs out.
  async function leave() {
    setBusy(true);
    setError("");
    try {
      if (user?.newAccount) await http.delete("/api/me");
      else await http.post("/api/auth/logout");
      window.location.assign("/");
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  const fresh = user?.newAccount === true;
  return (
    <section className="prose">
      <span className="eyebrow">{fresh ? "가입" : "약관"}</span>
      <h1>{fresh ? "새 계정을 만들었습니다" : "약관 동의가 필요합니다"}</h1>
      <p>
        {user && fresh && (
          <>
            <strong>{user.name}</strong> ({user.email}) Google 계정으로 GhostManual 계정이
            만들어졌습니다.{" "}
          </>
        )}
        {user && !fresh && (
          <>
            <strong>{user.name}</strong> ({user.email}) 계정은 아직 약관에 동의하지 않았습니다.{" "}
          </>
        )}
        이용약관과 개인정보 안내에 동의하면 바로 시작합니다.
      </p>
      <form method="post" onSubmit={start}>
        <TermsConsent checked={agreed} onChange={setAgreed} />
        <div className="actions">
          <button type="submit" disabled={!ready || busy || !agreed}>
            동의하고 시작하기
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!ready || busy || !user}
            onClick={leave}
          >
            {fresh ? "동의하지 않고 나가기" : "로그아웃"}
          </button>
        </div>
      </form>
      {fresh && (
        <p className="help">
          다른 Google 계정으로 들어오려던 거라면 "동의하지 않고 나가기"를 누르세요. 방금 만든 계정은
          삭제됩니다.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
