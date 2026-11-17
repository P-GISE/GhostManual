import { transaction } from "../../../lib/db.ts";
import { AppError } from "../../../lib/errors.ts";
import { MAX_FILE_BYTES } from "../../../lib/file-sources.ts";
import { endpoint, json, readBody, requestSession } from "../../../lib/http.ts";
import { assertTemplateOwner, registerTemplate } from "../../../lib/template-extraction.ts";

export async function POST(request: Request) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    await transaction((db) => assertTemplateOwner(db, ctx));
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data"))
      throw new AppError("invalid_input", 422, "양식 파일을 선택하세요.");
    const form = await new Response(await readBody(request, MAX_FILE_BYTES + 65536), {
      headers: { "content-type": type },
    })
      .formData()
      .catch(() => {
        throw new AppError("invalid_input", 422, "양식 파일을 읽을 수 없습니다.");
      });
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("invalid_input", 422, "양식 파일을 선택하세요.");
    return json(
      await registerTemplate(ctx, file.name, new Uint8Array(await file.arrayBuffer())),
      202,
    );
  });
}
