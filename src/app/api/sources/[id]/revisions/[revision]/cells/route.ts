import { z } from "zod";
import { cellChanges } from "../../../../../../../lib/file-sources.ts";
import { endpoint, json, requestSession } from "../../../../../../../lib/http.ts";

type Context = { params: Promise<{ id: string; revision: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () => {
    const params = await context.params;
    return json(
      await cellChanges(
        await requestSession(request),
        z.uuid().parse(params.id),
        z.coerce.number().int().positive().parse(params.revision),
      ),
    );
  });
}
