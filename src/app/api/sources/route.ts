import { AppError } from "../../../lib/errors.ts";
import { createFileSource, MAX_FILE_BYTES } from "../../../lib/file-sources.ts";
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
      // Multipart overhead on top of the largest allowed file; per-type limits are checked below.
      const limit = MAX_FILE_BYTES + 65536;
      if (Number(request.headers.get("content-length") ?? 0) > limit)
        throw new AppError("file_too_large", 413, "파일은 5 MB까지 올릴 수 있습니다.");
      const form = await new Response(await readBody(request, limit), {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
      const file = form.get("file"),
        title = form.get("title");
      if (!(file instanceof File) || typeof title !== "string")
        throw new AppError("invalid_input", 422, "파일과 제목이 필요합니다.");
      if (/\.xlsx$/i.test(file.name))
        return json(
          await createFileSource(ctx, {
            title,
            fileName: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          }),
          201,
        );
      input = await parseTextUpload(file, title);
    } else input = SourceInputSchema.parse(await readJson(request));
    return json(await createSource(ctx, input), 201);
  });
}
