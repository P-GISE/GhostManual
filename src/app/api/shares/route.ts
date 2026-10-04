import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../lib/http.ts";
import { createShare, listShares } from "../../../lib/shares.ts";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const input = z.strictObject({ manualId: z.uuid() }).parse(await readJson(request));
    return json(await createShare(await requestSession(request), input.manualId), 201);
  });
}

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const manualId = z.uuid().parse(new URL(request.url).searchParams.get("manualId"));
    return json(await listShares(await requestSession(request), manualId));
  });
}
