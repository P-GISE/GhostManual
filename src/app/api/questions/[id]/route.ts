import { getQuestion } from "../../../../lib/answers.ts";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () =>
    json(await getQuestion(await requestSession(request), (await params).id)),
  );
}
