import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../lib/http.ts";
import { createTeam, listWorkspaces } from "../../../lib/teams.ts";

export async function GET(request: Request) {
  return endpoint(request, async () => json(await listWorkspaces(await requestSession(request))));
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const input = z.strictObject({ name: z.string() }).parse(await readJson(request));
    return json(await createTeam(ctx, input.name), 201);
  });
}
