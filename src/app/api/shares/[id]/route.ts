import { z } from "zod";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
import { revokeShare } from "../../../../lib/shares.ts";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const { id } = await context.params;
    await revokeShare(await requestSession(request), z.uuid().parse(id));
    return json({ deleted: true });
  });
}
