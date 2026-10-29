import { agreeTerms } from "../../../../lib/accounts.ts";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await agreeTerms(await requestSession(request, { allowPendingTerms: true }));
    return json({ agreed: true });
  });
}
