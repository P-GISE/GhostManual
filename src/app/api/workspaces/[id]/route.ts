import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../lib/http.ts";
import { deleteTeam, renameTeam } from "../../../../lib/teams.ts";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const input = z.strictObject({ name: z.string() }).parse(await readJson(request));
    return json(await renameTeam(ctx, z.uuid().parse((await context.params).id), input.name));
  });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const input = z.strictObject({ name: z.string() }).parse(await readJson(request));
    await deleteTeam(ctx, z.uuid().parse((await context.params).id), input.name);
    return json({ deleted: true });
  });
}
