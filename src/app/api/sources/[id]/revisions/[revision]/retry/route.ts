import { z } from "zod";
import { retryDocument } from "../../../../../../../lib/document-sources.ts";
import { endpoint, json, readJson, requestSession } from "../../../../../../../lib/http.ts";

type Context = { params: Promise<{ id: string; revision: string }> };
export async function POST(request: Request, context: Context) {
  return endpoint(request, async () => {
    const params = await context.params;
    const ctx = await requestSession(request);
    const input = z
      .strictObject({ expectedRevision: z.number().int().positive() })
      .parse(await readJson(request));
    return json(
      await retryDocument(
        ctx,
        z.uuid().parse(params.id),
        z.coerce.number().int().positive().parse(params.revision),
        input.expectedRevision,
      ),
      202,
    );
  });
}
