import { endpoint, json, requestSession } from "../../../lib/http.ts";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    return json({ role: ctx.role, expiresAt: ctx.expiresAt, manualId: ctx.manualId });
  });
}
