import { SignupSchema, signup } from "../../../../lib/accounts.ts";
import { endpoint, json, readJson } from "../../../../lib/http.ts";
import { limitRequest } from "../../../../lib/rate-limit.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await limitRequest(request, "signup");
    await signup(SignupSchema.parse(await readJson(request)));
    return json({ sent: true }, 202);
  });
}
