import { generateManual } from "./ai.ts";
import { AppError } from "./errors.ts";
import { getManual, listManuals, saveDraft } from "./manuals.ts";
import { finishOperation, payloadHash, reserveAiAttempt } from "./operations.ts";
import { fileReadonly, getSource } from "./sources.ts";
import type { SessionContext } from "./types.ts";
export async function generateDraft(
  ctx: SessionContext,
  input: { sourceId: string; expectedRevision: number; key: string },
) {
  if (ctx.role !== "owner") throw new AppError("forbidden", 403, "소유자만 생성할 수 있습니다.");
  const source = await getSource(ctx, input.sourceId);
  if (source.kind === "file") throw fileReadonly();
  if (process.env["AI_ENABLED"] !== "true" || !process.env["ANTHROPIC_API_KEY"])
    throw new AppError(
      "ai_disabled",
      503,
      "AI 연결 전입니다. 자료 저장과 직접 편집, 사전 작성 예시는 사용할 수 있습니다.",
    );
  if (source.revision !== input.expectedRevision)
    throw new AppError("conflict", 409, "자료가 변경됐습니다.");
  const existing = (await listManuals(ctx)).find((m) => m.sourceId === source.id);
  const operation = await reserveAiAttempt(ctx, {
    kind: "generate",
    key: input.key,
    payloadHash: payloadHash({ sourceId: source.id, revision: source.revision }),
  });
  if (operation.status === "processing" && !operation.isNew)
    return { processing: true, operationId: operation.id };
  if (operation.status === "complete") {
    const value = operation.result;
    if (
      typeof value === "object" &&
      value !== null &&
      "manualId" in value &&
      typeof value.manualId === "string"
    )
      return { manual: await getManual(ctx, value.manualId), operationId: operation.id };
    throw new AppError("operation_missing", 409, "이 작업 결과가 삭제됐습니다.");
  }
  if (operation.status === "failed")
    throw new AppError(
      operation.error_code ?? "ai_failed",
      503,
      "이 요청은 실패했습니다. 새 요청으로 다시 시도하세요.",
    );
  try {
    const draft = await generateManual(source);
    const manual = await saveDraft(ctx, source.revisionId, draft, existing?.draftRevision, "ai");
    await finishOperation(operation.id, { result: { manualId: manual.id } });
    return { manual, operationId: operation.id };
  } catch (error) {
    await finishOperation(operation.id, {
      errorCode: error instanceof AppError ? error.code : "ai_failed",
    });
    throw error;
  }
}
