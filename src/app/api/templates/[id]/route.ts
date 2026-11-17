import { z } from "zod";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
import { deleteTemplate, getTemplate } from "../../../../lib/template-extraction.ts";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () =>
    json(
      await getTemplate(await requestSession(request), z.uuid().parse((await context.params).id)),
    ),
  );
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(request, async () => {
    await deleteTemplate(await requestSession(request), z.uuid().parse((await context.params).id));
    return json({ deleted: true });
  });
}
