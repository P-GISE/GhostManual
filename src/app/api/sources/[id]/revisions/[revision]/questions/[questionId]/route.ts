import { z } from "zod";
import { answerQuestion } from "../../../../../../../../lib/file-sources.ts";
import { endpoint, json, readJson, requestSession } from "../../../../../../../../lib/http.ts";

type Context = { params: Promise<{ id: string; revision: string; questionId: string }> };
export async function PUT(request: Request, context: Context) {
  return endpoint(request, async () => {
    const params = await context.params;
    return json(
      await answerQuestion(
        await requestSession(request),
        z.uuid().parse(params.id),
        z.coerce.number().int().positive().parse(params.revision),
        z.uuid().parse(params.questionId),
        await readJson(request),
      ),
    );
  });
}
