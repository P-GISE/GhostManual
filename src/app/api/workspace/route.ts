import { endpoint, json, requestSession } from "../../../lib/http.ts";
import { deleteWorkspace } from "../../../lib/retention.ts";
export async function DELETE(request: Request) {
  return endpoint(request, async () => {
    await deleteWorkspace(await requestSession(request));
    const response = json({ deleted: true });
    response.headers.append("Set-Cookie", "gm_owner=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    response.headers.append("Set-Cookie", "gm_reader=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return response;
  });
}
