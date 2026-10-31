import { currentUser, deleteAccount, updateProfile } from "../../../lib/accounts.ts";
import {
  clearSessionCookies,
  endpoint,
  json,
  readJson,
  requestSession,
} from "../../../lib/http.ts";
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
export async function PATCH(request: Request) {
  return endpoint(request, async () =>
    json(await updateProfile(await requestSession(request), await readJson(request))),
  );
}
