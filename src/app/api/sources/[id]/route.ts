import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../lib/http.ts";
import { SourceInputSchema } from "../../../../lib/schemas.ts";
import { getSource, updateSource } from "../../../../lib/sources.ts";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () =>
    json(await getSource(await requestSession(request), z.uuid().parse((await context.params).id))),
  );
}
export async function PATCH(request: Request, context: Context) {
  return endpoint(request, async () => {
    const input = SourceInputSchema.extend({ expectedRevision: z.number().int().positive() }).parse(
      await readJson(request),
    );
    return json(
      await updateSource(
        await requestSession(request),
        z.uuid().parse((await context.params).id),
        { title: input.title, text: input.text },
        input.expectedRevision,
      ),
    );
  });
}

import { deleteSource } from "../../../../lib/retention.ts";
export async function DELETE(request: Request, context: Context) {
  return endpoint(request, async () => {
    await deleteSource(await requestSession(request), z.uuid().parse((await context.params).id));
    return json({ deleted: true });
  });
}
