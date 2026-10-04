import { z } from "zod";
import { ask } from "../../../lib/answers.ts";
import { endpoint, json, readJson, requestSession } from "../../../lib/http.ts";
import { limitRequest } from "../../../lib/rate-limit.ts";
import { QuestionInputSchema } from "../../../lib/schemas.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await limitRequest(request, "ai");
    return json(
      await ask(
        await requestSession(request),
        QuestionInputSchema.parse(await readJson(request)),
        z.string().min(8).max(128).parse(request.headers.get("idempotency-key")),
      ),
    );
  });
}
