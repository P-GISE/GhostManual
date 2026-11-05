import { z } from "zod";
import { updateUser } from "../../../../../lib/admin.ts";
import { endpoint, json, readJson, requestSession } from "../../../../../lib/http.ts";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return endpoint(request, async () =>
    json(
      await updateUser(
        await requestSession(request),
        z.uuid().parse((await context.params).id),
        await readJson(request),
      ),
    ),
  );
}
