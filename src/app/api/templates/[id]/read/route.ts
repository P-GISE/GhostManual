import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../../lib/http.ts";
import { readTemplate } from "../../../../../lib/templates.ts";

type Context = { params: Promise<{ id: string }> };
const inputSchema = z.strictObject({ candidateIds: z.array(z.string()) });
export async function POST(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const input = inputSchema.parse(await readJson(request));
    return json(
      await readTemplate(ctx, z.uuid().parse((await context.params).id), input.candidateIds),
    );
  });
}
