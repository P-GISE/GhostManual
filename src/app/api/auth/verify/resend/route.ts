import { z } from "zod";
import { resendVerification } from "../../../../../lib/accounts.ts";
import { endpoint, json, readJson } from "../../../../../lib/http.ts";
import { limitRequest } from "../../../../../lib/rate-limit.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await limitRequest(request, "resend");
    const input = z
      .strictObject({ email: z.string(), next: z.string().max(2048).optional() })
      .parse(await readJson(request));
    await resendVerification(input.email, input.next);
    return json({ sent: true }, 202);
  });
}
