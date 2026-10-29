import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../lib/http.ts";
import { getSharing, setSharing } from "../../../lib/shares.ts";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const manualId = z.uuid().parse(new URL(request.url).searchParams.get("manualId"));
    return json(await getSharing(await requestSession(request), manualId));
  });
}
export async function PUT(request: Request) {
  return endpoint(request, async () => {
    const input = z
      .strictObject({ manualId: z.uuid(), mode: z.enum(["private", "link"]) })
      .parse(await readJson(request));
    return json(await setSharing(await requestSession(request), input.manualId, input.mode));
  });
}
