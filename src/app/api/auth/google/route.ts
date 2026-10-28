import { AppError } from "../../../../lib/errors.ts";
import { startGoogle } from "../../../../lib/google.ts";
import { responseHeaders } from "../../../../lib/http.ts";
export async function GET(request: Request) {
  const origin = process.env["APP_ORIGIN"] ?? new URL(request.url).origin;
  let location: string;
  try {
    location = await startGoogle(new URL(request.url).searchParams.get("next") ?? "/manuals");
  } catch (error) {
    const code = error instanceof AppError ? error.code : "google_failed";
    location = `${origin}/login?error=${code}`;
  }
  return new Response(null, { status: 303, headers: { ...responseHeaders, Location: location } });
}
