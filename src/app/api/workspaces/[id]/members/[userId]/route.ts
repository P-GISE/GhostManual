import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../../../lib/http.ts";
import { changeRole, removeMember } from "../../../../../../lib/teams.ts";

type Context = { params: Promise<{ id: string; userId: string }> };
export async function PATCH(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const params = await context.params;
    const input = z
      .strictObject({ role: z.enum(["admin", "member"]) })
      .parse(await readJson(request));
    await changeRole(ctx, z.uuid().parse(params.id), z.uuid().parse(params.userId), input.role);
    return json({ role: input.role });
  });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const params = await context.params;
    await removeMember(ctx, z.uuid().parse(params.id), z.uuid().parse(params.userId));
    return json({ removed: true });
  });
}
