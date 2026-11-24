import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { lockAccountSession } from "./session.ts";
import { teamLeadEnforced } from "./team-lead.ts";
import type { SessionContext } from "./types.ts";

type Work = {
  id: string;
  title: string;
  manualTitle: string | null;
  kind: "text" | "file";
  fileType: string | null;
  provenance: string | null;
  revision: number;
  revisionAt: Date;
  createdByName: string | null;
  openQuestions: number;
  manualId: string | null;
  publishedVersion: number | null;
  needsReview: boolean;
  unpublishedChanges: boolean;
};

// "내 문서함": 요청한 계정이 팀원인 모든 팀의 업무를 한 번에 읽는다. 세션이 어느 문서함에 묶여 있든 결과는 같다.
// 팀원 자격은 이 조회 안에서 팀마다 확인한다. 개인 문서함은 옮기지 않은 업무가 남아 있을 때만 돌려준다.
export async function getOverview(ctx: SessionContext) {
  if (ctx.role !== "owner" || !ctx.userId)
    throw new AppError("not_found", 404, "문서함을 찾을 수 없습니다.");
  const userId = ctx.userId;
  return transaction(async (db) => {
    await lockAccountSession(db, ctx);
    const enforced = await teamLeadEnforced(db);
    const spaces = await db.query<{
      id: string;
      name: string | null;
      role: "admin" | "member" | null;
      leadUserId: string | null;
      memberCount: number;
    }>(
      `SELECT w.id,w.team_name AS name,m.role,w.lead_user_id AS "leadUserId",
          (SELECT count(*)::int FROM workspace_members c WHERE c.workspace_id=w.id) AS "memberCount"
        FROM workspaces w
        LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1
        WHERE w.expires_at>now() AND ((w.team_name IS NULL AND w.user_id=$1) OR m.user_id=$1)
        ORDER BY w.team_name NULLS FIRST,w.id`,
      [userId],
    );
    const works = await db.query<Work & { workspaceId: string }>(
      `SELECT s.workspace_id AS "workspaceId",s.id,r.title,m.draft->>'title' AS "manualTitle",s.kind,
          s.file_type AS "fileType",m.provenance,s.revision,r.created_at AS "revisionAt",
          (SELECT f.uploaded_by_name FROM source_revisions f WHERE f.source_id=s.id AND f.revision=1) AS "createdByName",
          (SELECT count(*)::int FROM revision_questions q JOIN source_revisions qr ON qr.id=q.revision_id
            WHERE qr.source_id=s.id AND q.answer IS NULL AND NOT q.skipped) AS "openQuestions",
          m.id AS "manualId",m.published_version AS "publishedVersion",COALESCE(m.needs_review,false) AS "needsReview",
          COALESCE(m.draft<>v.content,false) AS "unpublishedChanges"
        FROM sources s
        JOIN source_revisions r ON r.source_id=s.id AND r.revision=s.revision
        LEFT JOIN manuals m ON m.source_id=s.id
        LEFT JOIN manual_versions v ON v.manual_id=m.id AND v.version=m.published_version
        WHERE s.workspace_id=ANY($1::uuid[]) ORDER BY s.created_at DESC`,
      [spaces.rows.map((space) => space.id)],
    );
    const worksOf = (workspaceId: string, team: boolean) =>
      works.rows
        .filter((work) => work.workspaceId === workspaceId)
        // 올린 사람 이름은 팀 문서함에서만 보여 준다(업무 목록과 같은 규칙).
        .map(({ workspaceId: _, ...work }) => (team ? work : { ...work, createdByName: null }));
    const personal = spaces.rows.find((space) => space.name === null);
    const personalWorks = personal ? worksOf(personal.id, false) : [];
    return {
      teams: spaces.rows
        .filter((space) => space.name !== null)
        .map((space) => ({
          id: space.id,
          name: space.name,
          role: space.role,
          // 대표 관리자는 migration 014가 적용된 뒤에만 정해져 있다.
          leadReady: enforced && space.leadUserId !== null,
          lead: enforced && space.leadUserId === userId,
          memberCount: space.memberCount,
          current: space.id === ctx.workspaceId,
          works: worksOf(space.id, true),
        })),
      personal:
        personal && personalWorks.length
          ? { id: personal.id, current: personal.id === ctx.workspaceId, works: personalWorks }
          : null,
    };
  });
}
