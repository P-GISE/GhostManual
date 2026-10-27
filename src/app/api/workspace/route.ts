import { deleteAccount } from "../../../lib/accounts.ts";
import { clearSessionCookies, endpoint, json, requestSession } from "../../../lib/http.ts";
export async function DELETE(request: Request) {
  return endpoint(request, async () => {
    await deleteAccount(await requestSession(request));
    return clearSessionCookies(json({ deleted: true }));
  });
}
