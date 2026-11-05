import { z } from "zod";
import { AppError } from "../../../../../lib/errors.ts";
import {
  addFileRevision,
  listFileRevisions,
  MAX_FILE_BYTES,
} from "../../../../../lib/file-sources.ts";
import { endpoint, json, readBody, requestSession } from "../../../../../lib/http.ts";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () =>
    json(
      await listFileRevisions(
        await requestSession(request),
        z.uuid().parse((await context.params).id),
      ),
    ),
  );
}
export async function POST(request: Request, context: Context) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request);
    const id = z.uuid().parse((await context.params).id);
    const limit = MAX_FILE_BYTES + 65536;
    if (Number(request.headers.get("content-length") ?? 0) > limit)
      throw new AppError("file_too_large", 413, "파일은 5 MB까지 올릴 수 있습니다.");
    const form = await new Response(await readBody(request, limit), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    const expectedRevision = z.coerce
      .number()
      .int()
      .positive()
      .safeParse(form.get("expectedRevision"));
    if (!(file instanceof File) || !expectedRevision.success)
      throw new AppError("invalid_input", 422, "파일과 버전 번호가 필요합니다.");
    if (!/\.(xlsx|docx|hwpx|pptx|csv|hwp|doc|ppt|pdf)$/i.test(file.name))
      throw new AppError(
        "file_type_mismatch",
        422,
        "같은 자료에는 같은 형식의 파일만 올릴 수 있습니다. 새 자료로 올리세요.",
      );
    return json(
      await addFileRevision(ctx, id, {
        fileName: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        expectedRevision: expectedRevision.data,
      }),
      /\.xlsx$/i.test(file.name) ? 201 : 202,
    );
  });
}
