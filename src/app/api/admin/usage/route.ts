import { aiUsage } from "../../../../lib/admin.ts";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const days = Number(new URL(request.url).searchParams.get("days") ?? 14);
    return json(await aiUsage(await requestSession(request), days));
  });
}
