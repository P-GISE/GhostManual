import { z } from "zod";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";

export const SourceMoveSchema = z
  .object({
    targetWorkspaceId: z.uuid(),
    acknowledgeAiHistoryDeletion: z.literal(true),
  })
  .strict();

export async function moveSource(bearer: string, sourceId: string, input: unknown) {
  const source = z.uuid().parse(sourceId);
  const { targetWorkspaceId } = SourceMoveSchema.parse(input);
  if (!/^[A-Za-z0-9_-]{43}$/.test(bearer))
    throw new AppError("unauthorized", 401, "로그인이 필요합니다.");
  try {
    await transaction(async (db) => {
      await db.query("SELECT public.move_personal_source_for_session($1,$2,$3)", [
        bearer,
        source,
        targetWorkspaceId,
      ]);
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "28000")
      throw new AppError("unauthorized", 401, "개인 문서함으로 로그인한 뒤 다시 시도하세요.");
    if (code === "42501")
      throw new AppError("forbidden", 403, "대상 팀 문서함의 권한을 확인하세요.");
    if (code === "22023") throw new AppError("not_found", 404, "옮길 업무를 찾을 수 없습니다.");
    if (
      code === "23514" &&
      (error as { message?: string }).message === "Destination storage limit exceeded"
    )
      throw new AppError("storage_limit", 409, "대상 팀 문서함의 저장 공간이 부족합니다.");
    if (code === "55000")
      throw new AppError("pending_work", 409, "진행 중인 작업이 끝난 뒤 옮겨 주세요.");
    if (code === "40001" || code === "40P01")
      throw new AppError("conflict", 409, "업무가 변경되었습니다. 새로고침 후 다시 시도하세요.");
    throw error;
  }
  return { moved: true, workspaceId: targetWorkspaceId };
}
