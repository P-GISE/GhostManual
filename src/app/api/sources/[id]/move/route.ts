import { endpoint, json, readCookie, readJson, requestSession } from "../../../../../lib/http.ts";
import { moveSource } from "../../../../../lib/source-move.ts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const session = await requestSession(request);
    if (session.role !== "owner")
      return json(
        { error: { code: "forbidden", message: "소유자 로그인이 필요합니다.", retryable: false } },
        403,
      );
    return json(
      await moveSource(
        readCookie(request, "gm_owner"),
        (await context.params).id,
        await readJson(request),
      ),
    );
  });
}
