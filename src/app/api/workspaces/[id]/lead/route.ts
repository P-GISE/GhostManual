import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../../lib/http.ts";
import { transferTeamLead } from "../../../../../lib/teams.ts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const id = z.uuid().parse((await context.params).id);
    const input = z.strictObject({ userId: z.uuid() }).parse(await readJson(request));
    return json(await transferTeamLead(ctx, id, input.userId));
  });
}
