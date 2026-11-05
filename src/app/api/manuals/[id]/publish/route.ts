import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../../lib/http.ts";
import { publishManual } from "../../../../../lib/manuals.ts";

type Context = { readonly params: Promise<{ id: string }> };
const inputSchema = z.strictObject({
  limitedAcknowledged: z.boolean().optional(),
  expectedRevision: z.number().int().positive(),
  acknowledgedUnknowns: z.array(z.string().min(1).max(500)).max(30),
});
export async function POST(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const input = inputSchema.parse(await readJson(request));
    return json(
      await publishManual(
        ctx,
        z.uuid().parse((await context.params).id),
        input.expectedRevision,
        input.acknowledgedUnknowns,
        input.limitedAcknowledged,
      ),
      201,
    );
  });
}
