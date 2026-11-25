import { z } from "zod";
import { endpoint, json, requestSession } from "../../../../../lib/http.ts";
import { getProgress } from "../../../../../lib/progress.ts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () =>
    json(
      await getProgress(
        await requestSession(request),
        z.uuid().parse((await context.params).id),
        new URL(request.url).searchParams,
      ),
    ),
  );
}
