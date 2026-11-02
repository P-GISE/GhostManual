import { z } from "zod";
import { similarSources } from "../../../../lib/file-sources.ts";
import { endpoint, json, requestSession } from "../../../../lib/http.ts";

const QuerySchema = z.object({
  fileName: z.string().min(1).max(255),
  title: z.string().max(120).default(""),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const query = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return json(await similarSources(await requestSession(request), query));
  });
}
