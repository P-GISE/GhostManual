import { z } from "zod";
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

const TEAM_PAGE = 20;
const WORK_PAGE = 10;
const querySchema = z
  .object({
    query: z.string().max(100).default(""),
    filter: z.enum(["all", "todo", "published"]).default("all"),
    afterTeam: z.uuid().optional(),
    workspaceId: z.uuid().optional(),
    afterWork: z
      .string()
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict()
  .refine((value) => !value.afterWork || !!value.workspaceId)
  .refine((value) => !value.afterTeam || !value.workspaceId);
const cursorSchema = z.tuple([z.iso.datetime({ precision: 6 }), z.uuid()]);
const invalidQuery = () => new AppError("invalid_input", 422, "조회 조건을 확인하세요.");

// Both the result and each subsequent page use the account's current membership snapshot.
const spacesSql = `WITH visible_spaces AS (
  SELECT w.* FROM workspaces w WHERE w.expires_at>now() AND (
    (w.team_name IS NULL AND w.user_id=$1) OR
    EXISTS(SELECT FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$1)
  )
)`;
const fromSql = `FROM sources s
  JOIN source_revisions r ON r.source_id=s.id AND r.revision=s.revision
  LEFT JOIN manuals m ON m.source_id=s.id
  LEFT JOIN manual_versions v ON v.manual_id=m.id AND v.version=m.published_version`;
const publishedSql = `COALESCE(m.published_version>0 AND NOT m.needs_review AND NOT COALESCE(m.draft<>v.content,false),false)`;
const questionsSql = `FROM revision_questions q JOIN source_revisions qr ON qr.id=q.revision_id
  WHERE qr.source_id=s.id AND q.answer IS NULL AND NOT q.skipped`;
const todoSql = `(NOT ${publishedSql} OR EXISTS(SELECT ${questionsSql}))`;
const matchingSql = `(strpos(lower(normalize(r.title||' '||COALESCE(m.draft->>'title',''),NFKC)),$2)>0
  AND ($3='all' OR ($3='published' AND ${publishedSql}) OR ($3='todo' AND ${todoSql})))`;

type Space = {
  id: string;
  name: string | null;
  role: "admin" | "member" | null;
  leadUserId: string | null;
  memberCount: number;
};
type RawWork = Work & { workspaceId: string; cursorTime: string };

export async function getOverview(ctx: SessionContext, params = new URLSearchParams()) {
  if (ctx.role !== "owner" || !ctx.userId)
    throw new AppError("not_found", 404, "문서함을 찾을 수 없습니다.");
  if (new Set(params.keys()).size !== [...params].length) throw invalidQuery();
  const options = querySchema.parse(Object.fromEntries(params));
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (options.afterWork) {
    try {
      const bytes = Buffer.from(options.afterWork, "base64url");
      if (bytes.toString("base64url") !== options.afterWork) throw invalidQuery();
      cursor = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    } catch {
      throw invalidQuery();
    }
  }
  const query = options.query.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
  const userId = ctx.userId;
  return transaction(async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("SET LOCAL statement_timeout = '5s'");
    await lockAccountSession(db, ctx);
    const enforced = await teamLeadEnforced(db);
    const spaces = await db.query<Space>(
      `${spacesSql}, selected_spaces AS (
        (SELECT w.* FROM visible_spaces w WHERE w.team_name IS NOT NULL
          AND ($5::uuid IS NULL OR w.id=$5) AND ($4::uuid IS NULL OR w.id>$4)
          AND ($5::uuid IS NOT NULL OR ($2='' AND $3='all') OR
            EXISTS(SELECT ${fromSql} WHERE s.workspace_id=w.id AND ${matchingSql}))
          ORDER BY w.id LIMIT ${TEAM_PAGE + 1})
        UNION ALL
        (SELECT w.* FROM visible_spaces w WHERE w.team_name IS NULL
          AND ($5::uuid IS NULL OR w.id=$5)
          AND ($5::uuid IS NOT NULL OR EXISTS(SELECT FROM sources s WHERE s.workspace_id=w.id))
          ORDER BY w.id LIMIT 1)
      )
      /* overview-spaces */
      SELECT w.id,w.team_name AS name,m.role,w.lead_user_id AS "leadUserId",
        (SELECT count(*)::int FROM workspace_members c WHERE c.workspace_id=w.id) AS "memberCount"
      FROM selected_spaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1
      ORDER BY w.team_name IS NOT NULL,w.id`,
      [userId, query, options.filter, options.afterTeam ?? null, options.workspaceId ?? null],
    );
    if (options.workspaceId && !spaces.rows.length)
      throw new AppError("not_found", 404, "문서함을 찾을 수 없습니다.");
    const teamRows = spaces.rows.filter((space) => space.name !== null);
    const nextTeamCursor =
      teamRows.length > TEAM_PAGE ? (teamRows[TEAM_PAGE - 1]?.id ?? null) : null;
    const selected = [
      ...teamRows.slice(0, TEAM_PAGE),
      ...spaces.rows.filter((space) => space.name === null),
    ];
    const ids = selected.map((space) => space.id);
    const counts = (
      await db.query<{ all: number; todo: number; published: number }>(
        `${spacesSql} SELECT count(*)::int AS all,
        count(*) FILTER(WHERE ${todoSql})::int AS todo,
        count(*) FILTER(WHERE ${publishedSql})::int AS published
      ${fromSql} WHERE s.workspace_id IN(SELECT id FROM visible_spaces)`,
        [userId],
      )
    ).rows[0] ?? { all: 0, todo: 0, published: 0 };
    const statistics = await db.query<{
      workspaceId: string;
      workCount: number;
      matchingCount: number;
    }>(
      `SELECT s.workspace_id AS "workspaceId",count(*)::int AS "workCount",
        count(*) FILTER(WHERE ${matchingSql})::int AS "matchingCount"
        ${fromSql} WHERE s.workspace_id=ANY($1::uuid[]) GROUP BY s.workspace_id`,
      [ids, query, options.filter],
    );
    const works = await db.query<RawWork>(
      `SELECT page.* FROM unnest($1::uuid[]) wanted(id) CROSS JOIN LATERAL (
        SELECT s.workspace_id AS "workspaceId",s.id,r.title,m.draft->>'title' AS "manualTitle",s.kind,
          s.file_type AS "fileType",m.provenance,s.revision,r.created_at AS "revisionAt",
          (SELECT f.uploaded_by_name FROM source_revisions f WHERE f.source_id=s.id AND f.revision=1) AS "createdByName",
          (SELECT count(*)::int ${questionsSql}) AS "openQuestions",
          m.id AS "manualId",m.published_version AS "publishedVersion",COALESCE(m.needs_review,false) AS "needsReview",
          COALESCE(m.draft<>v.content,false) AS "unpublishedChanges",
          to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime"
        ${fromSql} WHERE s.workspace_id=wanted.id AND ${matchingSql}
          AND ($4::timestamptz IS NULL OR (s.created_at,s.id)<($4::timestamptz,$5::uuid))
        ORDER BY s.created_at DESC,s.id DESC LIMIT ${WORK_PAGE + 1}
      ) page ORDER BY wanted.id,page."cursorTime" DESC,page.id DESC`,
      [ids, query, options.filter, cursor?.[0] ?? null, cursor?.[1] ?? null],
    );
    const byWorkspace = new Map<string, RawWork[]>();
    for (const work of works.rows) {
      const list = byWorkspace.get(work.workspaceId) ?? [];
      list.push(work);
      byWorkspace.set(work.workspaceId, list);
    }
    const stats = new Map(statistics.rows.map((row) => [row.workspaceId, row]));
    const pageOf = (space: Space) => {
      const rows = byWorkspace.get(space.id) ?? [];
      const last = rows[WORK_PAGE - 1];
      return {
        workCount: stats.get(space.id)?.workCount ?? 0,
        matchingCount: stats.get(space.id)?.matchingCount ?? 0,
        nextWorkCursor:
          rows.length > WORK_PAGE && last
            ? Buffer.from(JSON.stringify([last.cursorTime, last.id])).toString("base64url")
            : null,
        works: rows
          .slice(0, WORK_PAGE)
          .map(({ workspaceId: _, cursorTime: __, ...work }) =>
            space.name === null ? { ...work, createdByName: null } : work,
          ),
      };
    };
    const personal = selected.find((space) => space.name === null);
    return {
      teams: selected
        .filter((space) => space.name !== null)
        .map((space) => ({
          id: space.id,
          name: space.name,
          role: space.role,
          leadReady: enforced && space.leadUserId !== null,
          lead: enforced && space.leadUserId === userId,
          memberCount: space.memberCount,
          current: space.id === ctx.workspaceId,
          ...pageOf(space),
        })),
      personal:
        personal && (stats.get(personal.id)?.workCount ?? 0) > 0
          ? { id: personal.id, current: personal.id === ctx.workspaceId, ...pageOf(personal) }
          : null,
      counts,
      nextTeamCursor,
    };
  });
}
