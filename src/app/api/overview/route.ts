import { endpoint, json, requestSession } from "../../../lib/http.ts";
import { getOverview } from "../../../lib/overview.ts";

export async function GET(request: Request) {
  return endpoint(request, async () => json(await getOverview(await requestSession(request))));
}
