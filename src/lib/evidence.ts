import { z } from "zod";
import { questionInTransaction } from "./answers.ts";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertSession } from "./session.ts";
import type { SessionContext } from "./types.ts";
export async function getEvidence(ctx: SessionContext, id: string) {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    const rows = await db.query<Record<string, unknown>>(
      "SELECT question_id FROM evidence WHERE id=$1 AND workspace_id=$2",
      [z.uuid().parse(id), ctx.workspaceId],
    );
    if (!rows.rows[0]) throw new AppError("not_found", 404, "근거를 찾을 수 없습니다.");
    const result = await questionInTransaction(
      db,
      ctx,
      z.uuid().parse(rows.rows[0]["question_id"]),
    );
    const candidate = result.evidence.find((item) => item.id === id);
    if (!candidate) throw new AppError("not_found", 404, "근거를 찾을 수 없습니다.");
    return { ...candidate, questionId: result.id, isOutdated: result.isOutdated };
  });
}
