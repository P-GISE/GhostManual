import { z } from "zod";
import { requestPasswordReset } from "../../../../lib/accounts.ts";
import { endpoint, json, readJson } from "../../../../lib/http.ts";
import { limitRequest } from "../../../../lib/rate-limit.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await limitRequest(request, "reset");
    const input = z.strictObject({ email: z.string().max(320) }).parse(await readJson(request));
    await requestPasswordReset(input.email);
    return json({ sent: true }, 202);
  });
}
