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
  kind: z.enum(["text", "file"]).default("text"),
  openQuestions: z.number().default(0),
});
const questionSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  question: z.string(),
  answer: z.string().nullable(),
  skipped: z.boolean(),
  source: z.enum(["rule", "ai"]),
  groupPositions: z.array(z.number()),
});
export type Question = z.infer<typeof questionSchema>;
const fileBase = {
  revision: z.number(),
  revisionId: z.uuid(),
  createdAt: z.string(),
  uploadedByName: z.string().nullable(),
  uploadedByDepartment: z.string().nullable(),
  file: z.object({ name: z.string(), sizeBytes: z.number() }),
  compareStatus: z.enum(["first", "compared", "no_changes", "limit_exceeded"]),
};
export const revisionSummarySchema = z.object({
  ...fileBase,
  changeCount: z.number(),
  questionCount: z.number(),
  answeredCount: z.number(),
});
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;
export const fileRevisionSchema = z.object({
  ...fileBase,
  id: z.uuid(),
  title: z.string(),
  aiSummary: z.string().nullable(),
  changes: z.array(
    z.object({
      position: z.number(),
      kind: z.string(),
      sheet: z.string().nullable(),
      range: z.string().nullable(),
      summary: z.record(z.string(), z.unknown()),
    }),
  ),
  questions: z.array(questionSchema),
  usage: z.object({ bytes: z.number(), limitBytes: z.number() }),
  preview: z
    .array(
      z.object({
        sheet: z.string(),
        hidden: z.boolean(),
        rows: z.number(),
        cols: z.number(),
        cells: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      }),
    )
    .default([]),
});
export type FileRevision = z.infer<typeof fileRevisionSchema>;
export const questionResultSchema = questionSchema;
export const kst = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
export const fileSize = (bytes: number) =>
  bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
export const publishedSchema = z.object({
  id: z.uuid(),
  manualId: z.uuid(),
  version: z.number(),
  sourceRevisionId: z.uuid(),
  content: ManualDraftSchema,
  provenance: z.string(),
  acknowledgedUnknowns: z.array(z.string()),
  history: z
    .object({
      revisions: z.array(
        z.object({
          revision: z.number(),
          createdAt: z.string(),
          uploadedByName: z.string().nullable(),
          uploadedByDepartment: z.string().nullable(),
          fileName: z.string(),
          compareStatus: z.string(),
          aiSummary: z.string().nullable(),
          changes: z.array(
            z.object({
              kind: z.string(),
              sheet: z.string().nullable(),
              range: z.string().nullable(),
            }),
          ),
          questions: z.array(
            z.object({ question: z.string(), answer: z.string().nullable(), skipped: z.boolean() }),
          ),
        }),
      ),
    })
    .nullable()
    .default(null),
  createdAt: z.string(),
});
export type FileHistory = NonNullable<z.infer<typeof publishedSchema>["history"]>;
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
