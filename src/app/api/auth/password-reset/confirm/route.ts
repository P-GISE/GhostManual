import { z } from "zod";
import { confirmPasswordReset } from "../../../../../lib/accounts.ts";
import { clearSessionCookies, endpoint, json, readJson } from "../../../../../lib/http.ts";
import { limitRequest } from "../../../../../lib/rate-limit.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await limitRequest(request, "login");
    const input = z
      .strictObject({ token: z.string().max(64), password: z.string().max(128) })
      .parse(await readJson(request));
    await confirmPasswordReset(input.token, input.password);
    return clearSessionCookies(json({ reset: true }));
  });
}
