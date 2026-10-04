import ky, { HTTPError } from "ky";
import { z } from "zod";
import { ManualDraftSchema } from "./schemas";

export const sourceSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  revision: z.number(),
  title: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
const publishedSchema = z.object({
  id: z.uuid(),
  manualId: z.uuid(),
  version: z.number(),
  sourceRevisionId: z.uuid(),
  content: ManualDraftSchema,
  provenance: z.string(),
  acknowledgedUnknowns: z.array(z.string()),
  createdAt: z.string(),
});
export const manualSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  sourceRevisionId: z.uuid(),
  draft: ManualDraftSchema,
  draftRevision: z.number(),
  publishedVersion: z.number().nullable(),
  published: publishedSchema.nullable(),
  needsReview: z.boolean(),
  provenance: z.string(),
  createdAt: z.string(),
});
export type Source = z.infer<typeof sourceSchema>;
export type Manual = z.infer<typeof manualSchema>;
export const http = ky.create({ retry: 0, timeout: false, credentials: "same-origin" });
export async function read<T>(path: string, schema: z.ZodType<T>, reader = false): Promise<T> {
  return schema.parse(
    await http.get(path, { headers: reader ? { "x-ghost-role": "reader" } : {} }).json(),
  );
}
export async function message(error: unknown): Promise<string> {
  if (error instanceof HTTPError) {
    const body = z.object({ error: z.object({ message: z.string() }) }).safeParse(error.data);
    const instruction =
      error.response.status === 409
        ? " 현재 입력을 복사해 두고 최신 버전을 다시 확인하세요."
        : error.response.status === 429
          ? " 잠시 후 다시 시도하세요."
          : error.response.status === 401
            ? " 시작 화면에서 새 작업 공간을 열어 주세요."
            : "";
    return (body.success ? body.data.error.message : "요청을 처리할 수 없습니다.") + instruction;
  }
  return error instanceof Error
    ? "연결 또는 응답을 확인할 수 없습니다. 입력을 유지하고 다시 시도하세요."
    : "요청을 처리할 수 없습니다.";
}
