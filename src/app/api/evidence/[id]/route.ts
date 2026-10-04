import { getEvidence } from "../../../../lib/evidence.ts";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () =>
    json(await getEvidence(await requestSession(request), (await params).id)),
  );
}
