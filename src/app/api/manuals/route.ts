import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../lib/http.ts";
import { listManuals, saveDraft } from "../../../lib/manuals.ts";
import { ManualDraftSchema } from "../../../lib/schemas.ts";

const inputSchema = z.strictObject({
  sourceRevisionId: z.uuid(),
  draft: ManualDraftSchema,
  expectedDraftRevision: z.number().int().positive().optional(),
});
export async function GET(request: Request) {
  return endpoint(request, async () => json(await listManuals(await requestSession(request))));
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const input = inputSchema.parse(await readJson(request));
    return json(
      await saveDraft(ctx, input.sourceRevisionId, input.draft, input.expectedDraftRevision),
      201,
    );
  });
}
