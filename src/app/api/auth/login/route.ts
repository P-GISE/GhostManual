import { z } from "zod";
import { login } from "../../../../lib/accounts.ts";
import { endpoint, json, readJson, sessionCookie } from "../../../../lib/http.ts";
import { limitRequest } from "../../../../lib/rate-limit.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await limitRequest(request, "login");
    const input = z
      .strictObject({ email: z.string().max(320), password: z.string().max(128) })
      .parse(await readJson(request));
    const session = await login(input.email, input.password);
    const response = json({ expiresAt: session.expiresAt });
    response.headers.set("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return response;
  });
}
