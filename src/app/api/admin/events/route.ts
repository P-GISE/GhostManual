import { adminEvents } from "../../../../lib/admin.ts";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return json(await adminEvents(await requestSession(request), limit));
  });
}
