import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { lockAccountSession } from "./session.ts";
import type { SessionContext } from "./types.ts";

const missing = () => new AppError("not_found", 404, "팀 문서함을 찾을 수 없습니다.");

// 진행 현황: 팀의 업무마다 누가 올렸고 어디까지 왔는지. 관리자와 부관리자(admin)만 본다.
export async function getProgress(ctx: SessionContext, teamId: string) {
  if (ctx.role !== "owner" || !ctx.userId) throw missing();
  const userId = ctx.userId;
  return transaction(async (db) => {
    // 역할 확인과 업무 조회가 같은 스냅샷을 보게 한다(내 문서함 개요와 같은 방식).
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await lockAccountSession(db, ctx, teamId);
    const member = await db.query<{ role: "admin" | "member" }>(
      `SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
        WHERE m.workspace_id=$1 AND m.user_id=$2 AND w.team_name IS NOT NULL`,
      [teamId, userId],
    );
    const role = member.rows[0]?.role;
    if (!role) throw missing();
    if (role !== "admin")
      throw new AppError("forbidden", 403, "관리자와 부관리자만 진행 현황을 볼 수 있습니다.");
    const works = await db.query<{
      id: string;
      title: string;
      manualTitle: string | null;
      createdByName: string | null;
      revision: number;
      revisionAt: Date;
      openQuestions: number;
      manualId: string | null;
      publishedVersion: number | null;
      needsReview: boolean;
      unpublishedChanges: boolean;
    }>(
      `SELECT s.id,r.title,m.draft->>'title' AS "manualTitle",s.revision,r.created_at AS "revisionAt",
          (SELECT f.uploaded_by_name FROM source_revisions f WHERE f.source_id=s.id AND f.revision=1) AS "createdByName",
          (SELECT count(*)::int FROM revision_questions q JOIN source_revisions qr ON qr.id=q.revision_id
            WHERE qr.source_id=s.id AND q.answer IS NULL AND NOT q.skipped) AS "openQuestions",
          m.id AS "manualId",m.published_version AS "publishedVersion",COALESCE(m.needs_review,false) AS "needsReview",
          COALESCE(m.draft<>v.content,false) AS "unpublishedChanges"
        FROM sources s
        JOIN source_revisions r ON r.source_id=s.id AND r.revision=s.revision
        LEFT JOIN manuals m ON m.source_id=s.id
        LEFT JOIN manual_versions v ON v.manual_id=m.id AND v.version=m.published_version
        WHERE s.workspace_id=$1 ORDER BY s.created_at DESC`,
      [teamId],
    );
    return { works: works.rows };
  });
}
