import { z } from "zod";
import { AppError } from "../../../../lib/errors.ts";
import { endpoint, json, readJson, requestSession } from "../../../../lib/http.ts";
import { getManual, saveDraft } from "../../../../lib/manuals.ts";
import { ManualDraftSchema } from "../../../../lib/schemas.ts";
import { getSource } from "../../../../lib/sources.ts";

type Context = { readonly params: Promise<{ id: string }> };
const inputSchema = z.strictObject({
  sourceRevisionId: z.uuid(),
  draft: ManualDraftSchema,
  expectedDraftRevision: z.number().int().positive(),
});
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () =>
    json(await getManual(await requestSession(request), z.uuid().parse((await context.params).id))),
  );
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const id = z.uuid().parse((await context.params).id);
    const input = inputSchema.parse(await readJson(request));
    const current = await getManual(ctx, id);
    const source = await getSource(ctx, current.sourceId);
    if (source.revisionId !== input.sourceRevisionId)
      throw new AppError("conflict", 409, "연결된 자료 버전을 확인하세요.");
    return json(
      await saveDraft(ctx, input.sourceRevisionId, input.draft, input.expectedDraftRevision),
    );
  });
}
