import { endpoint, json, requestSession } from "../../../../lib/http.ts";
import { seedExample } from "../../../../lib/seed.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => json(await seedExample(await requestSession(request)), 201));
}
