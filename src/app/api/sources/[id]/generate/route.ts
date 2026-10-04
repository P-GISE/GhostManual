import { z } from "zod";
import { generateDraft } from "../../../../../lib/generation.ts";
import { endpoint, json, readJson, requestSession } from "../../../../../lib/http.ts";
import { limitRequest } from "../../../../../lib/rate-limit.ts";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    await limitRequest(request, "ai");
    const input = z
      .object({ expectedRevision: z.number().int().positive() })
      .parse(await readJson(request));
    const result = await generateDraft(await requestSession(request), {
      sourceId: z.uuid().parse((await context.params).id),
      expectedRevision: input.expectedRevision,
      key: z.string().min(8).max(128).parse(request.headers.get("idempotency-key")),
    });
    return json(result, "processing" in result ? 202 : 200);
  });
}
