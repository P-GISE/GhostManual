import { currentUser, deleteAccount } from "../../../lib/accounts.ts";
import { clearSessionCookies, endpoint, json, requestSession } from "../../../lib/http.ts";
export async function GET(request: Request) {
  return endpoint(request, async () =>
    json(await currentUser(await requestSession(request, { allowPendingTerms: true }))),
  );
}
export async function DELETE(request: Request) {
  return endpoint(request, async () => {
    await deleteAccount(await requestSession(request, { allowPendingTerms: true }));
    return clearSessionCookies(json({ deleted: true }));
  });
}
