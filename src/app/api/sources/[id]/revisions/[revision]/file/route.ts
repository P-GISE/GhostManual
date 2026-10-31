import { z } from "zod";
import { fileContent } from "../../../../../../../lib/file-sources.ts";
import { endpoint, requestSession } from "../../../../../../../lib/http.ts";

type Context = { params: Promise<{ id: string; revision: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () => {
    const params = await context.params;
    const file = await fileContent(
      await requestSession(request),
      z.uuid().parse(params.id),
      z.coerce.number().int().positive().parse(params.revision),
    );
    // Always a download: the browser must never render an uploaded workbook.
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  });
}
