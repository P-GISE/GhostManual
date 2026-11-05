import { listUsers } from "../../../../lib/admin.ts";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
export async function GET(request: Request) {
  return endpoint(request, async () => json(await listUsers(await requestSession(request))));
}
