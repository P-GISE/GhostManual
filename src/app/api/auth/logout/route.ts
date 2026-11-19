import { logout } from "../../../../lib/accounts.ts";
import { clearSessionCookies, endpoint, json, readCookie } from "../../../../lib/http.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await logout([readCookie(request, "gm_owner"), readCookie(request, "gm_reader")]);
    return clearSessionCookies(json({ loggedOut: true }));
  });
}
