import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../lib/http.ts";
import { acceptInvite } from "../../../../lib/teams.ts";

export async function POST(request: Request) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const input = z.strictObject({ token: z.string().max(100) }).parse(await readJson(request));
    return json(await acceptInvite(ctx, input.token));
  });
}
