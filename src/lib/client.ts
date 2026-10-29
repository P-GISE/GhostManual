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
export const publishedSchema = z.object({
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
// A signed-in account that still owes the terms agreement is sent to the consent page.
export const http = ky.create({
  retry: 0,
  timeout: false,
  credentials: "same-origin",
  hooks: {
    afterResponse: [
      async ({ response }) => {
        if (response.status !== 403 || typeof window === "undefined") return;
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        if (
          z.object({ error: z.object({ code: z.literal("terms_required") }) }).safeParse(body)
            .success &&
          window.location.pathname !== "/welcome"
        )
          window.location.assign(
            `/welcome?next=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`,
          );
      },
    ],
  },
});
export async function read<T>(path: string, schema: z.ZodType<T>, reader = false): Promise<T> {
  return schema.parse(
    await http.get(path, { headers: reader ? { "x-ghost-role": "reader" } : {} }).json(),
  );
}
export async function message(error: unknown): Promise<string> {
  if (error instanceof HTTPError) {
    const body = z
      .object({ error: z.object({ message: z.string(), code: z.string().optional() }) })
      .safeParse(error.data);
    const instruction =
      error.response.status === 409
        ? " 현재 입력을 복사해 두고 최신 버전을 다시 확인하세요."
        : error.response.status === 429
          ? " 잠시 후 다시 시도하세요."
          : error.response.status === 401 && body.data?.error.code !== "invalid_credentials"
            ? " 로그인 화면에서 다시 로그인해 주세요."
            : "";
    return (body.success ? body.data.error.message : "요청을 처리할 수 없습니다.") + instruction;
  }
  return error instanceof Error
    ? "연결 또는 응답을 확인할 수 없습니다. 입력을 유지하고 다시 시도하세요."
    : "요청을 처리할 수 없습니다.";
}
