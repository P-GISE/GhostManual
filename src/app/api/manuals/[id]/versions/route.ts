import { z } from "zod";
import { endpoint, json, requestSession } from "../../../../../lib/http.ts";
import { listManualVersions } from "../../../../../lib/manuals.ts";
export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
) {
  return endpoint(request, async () =>
    json(
      await listManualVersions(await requestSession(request), z.uuid().parse((await params).id)),
    ),
  );
}
