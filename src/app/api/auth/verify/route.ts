import { verifyEmail } from "../../../../lib/accounts.ts";
import { AppError } from "../../../../lib/errors.ts";
import { responseHeaders, sessionCookie } from "../../../../lib/http.ts";
export async function GET(request: Request) {
  const origin = process.env["APP_ORIGIN"] ?? new URL(request.url).origin;
  try {
    const session = await verifyEmail(new URL(request.url).searchParams.get("token") ?? "");
    return new Response(null, {
      status: 303,
      headers: {
        ...responseHeaders,
        Location: `${origin}/manuals`,
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
