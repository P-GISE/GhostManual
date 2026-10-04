import { z } from "zod";
import { endpoint, json, readJson, sessionCookie } from "../../../lib/http.ts";
import { exchangeShare } from "../../../lib/shares.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const input = z
      .strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .parse(await readJson(request));
    const session = await exchangeShare(input.token);
    const response = json({ manualId: session.manualId, expiresAt: session.expiresAt });
    response.headers.set("Set-Cookie", sessionCookie(session.token, session.expiresAt, true));
    return response;
  });
}
