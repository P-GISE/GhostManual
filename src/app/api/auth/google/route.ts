import { AppError } from "../../../../lib/errors.ts";
import { startGoogle } from "../../../../lib/google.ts";
import { responseHeaders } from "../../../../lib/http.ts";
export async function GET(request: Request) {
  const origin = process.env["APP_ORIGIN"] ?? new URL(request.url).origin;
  try {
    const location = await startGoogle(new URL(request.url).searchParams.get("next") ?? "/manuals");
    const state = new URL(location).searchParams.get("state") ?? "";
    // Binds the flow to this browser so a callback link from someone else is refused.
    const secure = origin.startsWith("https:") ? "; Secure" : "";
    return new Response(null, {
      status: 303,
      headers: {
        ...responseHeaders,
        Location: location,
        "Set-Cookie": `gm_oauth=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
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
