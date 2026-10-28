import { logout } from "../../../../lib/accounts.ts";
import { clearSessionCookies, endpoint, json, requestSession } from "../../../../lib/http.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await logout(await requestSession(request, { allowPendingTerms: true }));
    return clearSessionCookies(json({ loggedOut: true }));
  });
}
