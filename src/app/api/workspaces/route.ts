import { z } from "zod";
import { endpoint, json, readJson, sessionCookie } from "../../../lib/http.ts";
import { limitRequest } from "../../../lib/rate-limit.ts";
import { seedExample } from "../../../lib/seed.ts";
import { createWorkspace, requireSession } from "../../../lib/session.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await limitRequest(request, "workspace");
    const input = z.object({ mode: z.enum(["blank", "example"]) }).parse(await readJson(request));
    const session = await createWorkspace(input.mode);
    if (input.mode === "example") await seedExample(await requireSession(session.token));
    const response = json({ expiresAt: session.expiresAt }, 201);
    response.headers.set("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return response;
  });
}
