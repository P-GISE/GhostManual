import { AppError } from "../../../../../lib/errors.ts";
import { finishGoogle } from "../../../../../lib/google.ts";
import { responseHeaders, sessionCookie } from "../../../../../lib/http.ts";
import { limitRequest } from "../../../../../lib/rate-limit.ts";
export async function GET(request: Request) {
  const origin = process.env["APP_ORIGIN"] ?? new URL(request.url).origin;
  const params = new URL(request.url).searchParams;
  try {
    await limitRequest(request, "login");
    const session = await finishGoogle(params.get("state") ?? "", params.get("code") ?? "");
    return new Response(null, {
      status: 303,
      headers: {
        ...responseHeaders,
        Location: `${origin}${session.nextPath}`,
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
