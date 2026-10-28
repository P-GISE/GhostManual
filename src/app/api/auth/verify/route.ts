import { verifyEmail } from "../../../../lib/accounts.ts";
import { AppError } from "../../../../lib/errors.ts";
import { responseHeaders, sessionCookie } from "../../../../lib/http.ts";
import { safeNextPath } from "../../../../lib/next-path.ts";
export async function GET(request: Request) {
  const origin = process.env["APP_ORIGIN"] ?? new URL(request.url).origin;
  const params = new URL(request.url).searchParams;
  try {
    const session = await verifyEmail(params.get("token") ?? "");
    return new Response(null, {
      status: 303,
      headers: {
        ...responseHeaders,
        Location: `${origin}${safeNextPath(params.get("next"))}`,
        "Set-Cookie": sessionCookie(session.token, session.expiresAt),
      },
    });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "unavailable";
    return new Response(null, {
      status: 303,
      headers: { ...responseHeaders, Location: `${origin}/login?error=${code}` },
    });
  }
}
