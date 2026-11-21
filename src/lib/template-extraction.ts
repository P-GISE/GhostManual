import { workspaceStorageLimit } from "./admin.ts";
import { type DbClient, transaction } from "./db.ts";
import { detectDocumentFormat, readDocument } from "./documents/read.ts";
import { AppError } from "./errors.ts";
import { assertFileQuota, usedFileBytes } from "./file-sources.ts";
import { assertSession } from "./session.ts";
import { newId, type SessionContext } from "./types.ts";

export async function assertTemplateOwner(db: DbClient, ctx: SessionContext) {
  if (ctx.role !== "owner") throw missing();
  await assertSession(db, ctx, true);
  const account = await db.query(
    `SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspace_id JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND u.terms_agreed_at IS NOT NULL AND (w.user_id=s.user_id OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=w.id AND wm.user_id=s.user_id))`,
    [ctx.sessionId],
  );
  if (!account.rowCount) throw new AppError("unauthorized", 401, "양식을 관리하려면 로그인하세요.");
}

const missing = () => new AppError("not_found", 404, "양식을 찾을 수 없습니다.");

export async function registerTemplate(ctx: SessionContext, fileName: string, bytes: Uint8Array) {
  await transaction((db) => assertTemplateOwner(db, ctx));
  const format = detectDocumentFormat(fileName, bytes);
  if (format !== "docx" && format !== "hwpx")
    throw new AppError("invalid_input", 422, "DOCX 또는 HWPX 양식을 선택하세요.");
  return transaction(async (db) => {
    await assertTemplateOwner(db, ctx);
    const count = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM manual_templates WHERE workspace_id=$1",
      [ctx.workspaceId],
    );
    if (Number(count.rows[0]?.count) >= 20)
      throw new AppError("storage_quota", 429, "양식은 최대 20개까지 보관할 수 있습니다.");
    assertFileQuota(
      await usedFileBytes(db, ctx.workspaceId),
      bytes.length,
      await workspaceStorageLimit(db, ctx.workspaceId),
    );
    const id = newId();
    await db.query(
      "INSERT INTO manual_templates(id,workspace_id,name,file_name,file_type,content,created_by) VALUES($1,$2,$3,$3,$4,$5,(SELECT user_id FROM sessions WHERE id=$6))",
      [id, ctx.workspaceId, fileName.slice(0, 255), format, Buffer.from(bytes), ctx.sessionId],
    );
    await db.query(
      "INSERT INTO manual_template_jobs(template_id,workspace_id,session_id) VALUES($1,$2,$3)",
      [id, ctx.workspaceId, ctx.sessionId],
    );
    return { id, status: "reading" as const };
  });
}

// ready=true면 확정된 양식만 항목과 함께 돌려준다(매뉴얼을 만들 때 고르는 목록).
export async function listTemplates(ctx: SessionContext, ready = false) {
  return transaction(async (db) => {
    await assertTemplateOwner(db, ctx);
    const { rows } = await db.query(
      `SELECT id,name,status,file_bytes::int AS "fileBytes",jsonb_array_length(items) AS "itemCount",is_default AS "isDefault"${ready ? ",items" : ""} FROM manual_templates WHERE workspace_id=$1${ready ? " AND status='ready'" : ""} ORDER BY created_at DESC,id`,
      [ctx.workspaceId],
    );
    return rows;
  });
}

export async function getTemplate(ctx: SessionContext, id: string) {
  return transaction(async (db) => {
    await assertTemplateOwner(db, ctx);
    const { rows } = await db.query(
      `SELECT id,name,status,file_bytes::int AS "fileBytes",extraction,items,is_default AS "isDefault",file_name AS "fileName" FROM manual_templates WHERE workspace_id=$1 AND id=$2`,
      [ctx.workspaceId, id],
    );
    if (!rows[0]) throw missing();
    return rows[0];
  });
}

export async function deleteTemplate(ctx: SessionContext, id: string) {
  return transaction(async (db) => {
    await assertTemplateOwner(db, ctx);
    const found = await db.query<{ created_by: string | null }>(
      "SELECT created_by FROM manual_templates WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
      [ctx.workspaceId, id],
    );
    if (!found.rows[0]) throw missing();
    if (ctx.teamRole === "member" && found.rows[0].created_by !== ctx.userId)
      throw new AppError("forbidden", 403, "올린 사람과 팀 관리자만 이 양식을 삭제할 수 있습니다.");
    await db.query("DELETE FROM manual_templates WHERE workspace_id=$1 AND id=$2", [
      ctx.workspaceId,
      id,
    ]);
  });
}

type TemplateJob = {
  template_id: string;
  workspace_id: string;
  file_type: "docx" | "hwpx";
  content: Buffer;
};

const authorizedJob = `EXISTS (
  SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
  JOIN users u ON u.id=s.user_id
  WHERE s.id=j.session_id AND s.workspace_id=j.workspace_id AND s.role='owner'
    AND s.expires_at>now() AND w.expires_at>now() AND u.terms_agreed_at IS NOT NULL
    AND (w.user_id=s.user_id OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=w.id AND wm.user_id=s.user_id))
)`;

export async function runTemplateJob() {
  const token = newId();
  const job = await transaction(async (db) => {
    const { rows } =
      await db.query<TemplateJob>(`SELECT j.template_id,j.workspace_id,t.file_type,t.content
      FROM manual_template_jobs j JOIN manual_templates t ON t.id=j.template_id
      JOIN workspaces w ON w.id=j.workspace_id
      WHERE t.status='reading' AND (j.lease_until IS NULL OR j.lease_until<=now())
      ORDER BY j.created_at FOR UPDATE OF w SKIP LOCKED LIMIT 1`);
    const selected = rows[0];
    if (!selected) return undefined;
    const claimed = await db.query(
      `UPDATE manual_template_jobs j
      SET attempts=attempts+1,lease_token=$2,lease_until=now()+interval '3 minutes'
      WHERE j.template_id=$1 AND (j.lease_until IS NULL OR j.lease_until<=now())
        AND j.attempts<3 AND ${authorizedJob}`,
      [selected.template_id, token],
    );
    if (!claimed.rowCount) {
      const expired = await db.query(
        "DELETE FROM manual_template_jobs WHERE template_id=$1 AND (lease_until IS NULL OR lease_until<=now())",
        [selected.template_id],
      );
      if (expired.rowCount)
        await db.query("UPDATE manual_templates SET status='failed' WHERE id=$1", [
          selected.template_id,
        ]);
      return null;
    }
    return selected;
  });
  if (!job) return job === null;
  let extraction: unknown = null;
  let status = "failed";
  try {
    const result = readDocument(job.file_type, job.content);
    if (result.snapshot) {
      const candidates = result.snapshot.blocks.flatMap((block) =>
        (block.cells ?? [block.text]).flatMap((value, index) =>
          value.trim()
            ? [
                {
                  candidateId: `${block.path}:${index}`,
                  name: value.trim().slice(0, 80),
                  guide: "",
                  kind: "text",
                  sourceRefs: [
                    { blockPath: block.path, ...(block.cells ? { cellIndex: index } : {}) },
                  ],
                },
              ]
            : [],
        ),
      );
      extraction = {
        warnings: [
          ...result.coverage,
          "항목명 후보를 확인하세요. 작성된 값이 후보에 포함될 수 있습니다.",
          ...(candidates.length > 200 ? ["처음 200개 후보만 표시합니다."] : []),
        ],
        candidates: candidates.slice(0, 200),
      };
      status = "review";
    }
  } catch {
    // A rejected file can still be replaced or its fields entered manually.
  }
  await transaction(async (db) => {
    // Match deletion and upload lock order before touching the lease.
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [job.workspace_id]);
    const consumed = await db.query(
      `DELETE FROM manual_template_jobs j
      WHERE template_id=$1 AND lease_token=$2 AND lease_until>now() RETURNING ${authorizedJob} AS allowed`,
      [job.template_id, token],
    );
    if (consumed.rowCount) {
      const allowed = consumed.rows[0]?.allowed === true;
      await db.query(
        "UPDATE manual_templates SET status=$2,extraction=$3 WHERE id=$1 AND status='reading'",
        [job.template_id, allowed ? status : "failed", allowed ? extraction : null],
      );
    }
  });
  return true;
}
