import { AppError } from "../../../../../lib/errors.ts";
import { finishGoogle } from "../../../../../lib/google.ts";
import { responseHeaders, sessionCookie } from "../../../../../lib/http.ts";
import { limitRequest } from "../../../../../lib/rate-limit.ts";
export async function GET(request: Request) {
  const origin = process.env["APP_ORIGIN"] ?? new URL(request.url).origin;
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const started = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("gm_oauth="))
    ?.slice("gm_oauth=".length);
  try {
    if (!state || started !== state)
      throw new AppError("google_failed", 400, "구글 로그인을 완료하지 못했습니다.");
    await limitRequest(request, "login");
    const session = await finishGoogle(state, params.get("code") ?? "");
    return new Response(null, {
      status: 303,
      headers: {
        ...responseHeaders,
        Location: session.termsRequired
          ? `${origin}/welcome?next=${encodeURIComponent(session.nextPath)}`
          : `${origin}${session.nextPath}`,
        "Set-Cookie": sessionCookie(session.token, session.expiresAt),
      },
    });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "google_failed";
    return new Response(null, {
      status: 303,
      headers: { ...responseHeaders, Location: `${origin}/login?error=${code}` },
    });
  }
}
