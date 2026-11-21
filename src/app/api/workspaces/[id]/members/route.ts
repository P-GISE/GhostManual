import { z } from "zod";
import { endpoint, json, requestSession } from "../../../../../lib/http.ts";
import { listMembers } from "../../../../../lib/teams.ts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () =>
    json(
      await listMembers(await requestSession(request), z.uuid().parse((await context.params).id)),
    ),
  );
}
