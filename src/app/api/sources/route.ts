import { AppError } from "../../../lib/errors.ts";
import { endpoint, json, readBody, readJson, requestSession } from "../../../lib/http.ts";
import { parseTextUpload, type SourceInput, SourceInputSchema } from "../../../lib/schemas.ts";
import { createSource, listSources } from "../../../lib/sources.ts";
export async function GET(request: Request) {
  return endpoint(request, async () => json(await listSources(await requestSession(request))));
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    let input: SourceInput;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > 300000)
        throw new AppError("file_too_large", 413, "파일은 256 KiB까지 가능합니다.");
      const form = await new Response(await readBody(request, 300000), {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("file"),
        title = form.get("title");
      if (!(file instanceof File) || typeof title !== "string")
        throw new AppError("invalid_input", 422, "파일과 제목이 필요합니다.");
      input = await parseTextUpload(file, title);
    } else input = SourceInputSchema.parse(await readJson(request));
    return json(await createSource(ctx, input), 201);
  });
}
