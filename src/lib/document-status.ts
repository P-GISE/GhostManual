import { transaction } from "./db.ts";
import { documentStatusSchema } from "./document-progress.ts";
import { AppError } from "./errors.ts";
import { assertSession } from "./session.ts";
import type { SessionContext } from "./types.ts";

export async function getDocumentStatus(ctx: SessionContext, sourceId: string, revision: number) {
  return transaction(async (db) => {
    await assertSession(db, ctx, true);
    const result = await db.query(
      `SELECT r.id AS "revisionId", j.status
       FROM source_revisions r
       JOIN sources s ON s.id=r.source_id AND s.workspace_id=r.workspace_id
       JOIN document_jobs j ON j.revision_id=r.id AND j.workspace_id=r.workspace_id
       WHERE r.source_id=$1 AND r.workspace_id=$2 AND r.revision=$3`,
      [sourceId, ctx.workspaceId, revision],
    );
    if (!result.rows[0]) throw new AppError("not_found", 404, "문서 처리 상태를 찾을 수 없습니다.");
    return documentStatusSchema.parse(result.rows[0]);
  });
}
