import { z } from "zod";
import { endpoint, json, requestSession } from "../../../../../../lib/http.ts";
import { cancelInvite } from "../../../../../../lib/teams.ts";

type Context = { params: Promise<{ id: string; inviteId: string }> };
export async function DELETE(request: Request, context: Context) {
  return endpoint(request, async () => {
    const params = await context.params;
    await cancelInvite(
      await requestSession(request),
      z.uuid().parse(params.id),
      z.uuid().parse(params.inviteId),
    );
    return json({ cancelled: true });
  });
}
