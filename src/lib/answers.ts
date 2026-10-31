import { z } from "zod";
import { generateAnswer } from "./ai.ts";
import { EvidenceCandidateSchema } from "./ai-schemas.ts";
import { type DbClient, transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { finishOperation, payloadHash, reserveAiAttempt } from "./operations.ts";
import { retrieve } from "./retrieval.ts";
import { QuestionInputSchema } from "./schemas.ts";
import { assertSession } from "./session.ts";
import { newId, type SessionContext } from "./types.ts";

const claimSchema = z.object({ text: z.string(), evidenceIds: z.array(z.uuid()) });
export const QuestionResultSchema = z.object({
  id: z.uuid(),
  question: z.string(),
  status: z.enum(["supported", "partial", "insufficient", "unavailable"]),
  answer: z.string(),
  procedure: z.array(claimSchema),
  evidence: z.array(EvidenceCandidateSchema),
  searchResults: z.array(EvidenceCandidateSchema),
  confidence: z.enum(["supported", "partial", "insufficient"]).nullable(),
  insufficientEvidence: z.boolean().nullable(),
  limitations: z.array(z.string()),
  isOutdated: z.boolean(),
});
export type QuestionResult = z.infer<typeof QuestionResultSchema>;
export async function questionInTransaction(
  db: DbClient,
  ctx: SessionContext,
  id: string,
): Promise<QuestionResult> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT result FROM question_runs q WHERE q.id=$1 AND q.workspace_id=$2 AND ($3='owner' OR q.session_id=$4)`,
    [id, ctx.workspaceId, ctx.role, ctx.sessionId],
  );
  if (!rows.rows[0]) throw new AppError("not_found", 404, "질문을 찾을 수 없습니다.");
  const result = QuestionResultSchema.parse(rows.rows[0]["result"]);
  const candidates = [...result.evidence, ...result.searchResults];
  let isOutdated = false;
  for (const candidate of candidates) {
    const current = await db.query(
      `SELECT m.id FROM manuals m JOIN sources s ON s.id=m.source_id JOIN source_revisions r ON r.id=$4 WHERE m.id=$1 AND m.workspace_id=$2 AND m.published_version=$3 AND NOT m.needs_review AND s.revision=r.revision`,
      [candidate.manualId, ctx.workspaceId, candidate.version, candidate.sourceRevisionId],
    );
    if (!current.rowCount) isOutdated = true;
  }
  return { ...result, isOutdated };
}
export async function getQuestion(ctx: SessionContext, id: string): Promise<QuestionResult> {
  return transaction(async (db) => {
    await assertSession(db, ctx);
    return questionInTransaction(db, ctx, z.uuid().parse(id));
  });
}
export async function ask(
  ctx: SessionContext,
  input: z.infer<typeof QuestionInputSchema>,
  key: string,
): Promise<QuestionResult> {
  const parsed = QuestionInputSchema.parse(input);
  z.string().min(8).max(128).parse(key);
  const existing = await transaction(async (db) => {
    await assertSession(db, ctx);
    const rows = await db.query<Record<string, unknown>>(
      "SELECT payload_hash,status,result,error_code FROM operation_requests WHERE session_id=$1 AND key=$2",
      [ctx.sessionId, key],
    );
    return rows.rows[0];
  });
  const hash = payloadHash(parsed);
  if (existing) {
    if (existing["payload_hash"] !== hash)
      throw new AppError("idempotency_conflict", 409, "같은 요청 키의 내용이 변경됐습니다.");
    if (existing["status"] === "complete")
      return getQuestion(ctx, QuestionResultSchema.parse(existing["result"]).id);
    throw new AppError(
      "request_pending",
      409,
      "이 요청은 처리 중이거나 실패했습니다. 새로운 요청 키를 사용하세요.",
    );
  }
  const candidates = await retrieve(ctx, parsed.question, parsed.manualId);
  let operationId: string | null = null;
  let result: QuestionResult = {
    id: newId(),
    question: parsed.question,
    status: "insufficient",
    answer: "검수된 자료에서 질문에 답할 근거를 찾지 못했습니다.",
    procedure: [],
    evidence: [],
    searchResults: [],
    confidence: "insufficient",
    insufficientEvidence: true,
    limitations: ["담당자에게 확인할 자료를 요청하세요."],
    isOutdated: false,
  };
  if (candidates.length) {
    if (process.env["AI_ENABLED"] !== "true" || !process.env["ANTHROPIC_API_KEY"]) {
      result = {
        ...result,
        status: "unavailable",
        answer: "AI 답변을 사용할 수 없습니다. 검색된 자료를 직접 확인하세요.",
        confidence: null,
        insufficientEvidence: null,
        limitations: ["AI 연결이 필요합니다."],
        searchResults: [...candidates],
      };
    } else {
      const operation = await reserveAiAttempt(ctx, { kind: "question", key, payloadHash: hash });
      operationId = operation.id;
      if (operation.status === "complete")
        return getQuestion(ctx, QuestionResultSchema.parse(operation.result).id);
      if (!operation.isNew)
        throw new AppError("request_pending", 202, "같은 요청이 처리 중입니다.");
      try {
        const answer = await generateAnswer(candidates, parsed.question);
        const ids = new Set(
          [...answer.claims, ...answer.procedure].flatMap((claim) => claim.evidenceIds),
        );
        result = {
          ...result,
          status: answer.status,
          answer:
            answer.status === "insufficient"
              ? "자료는 검색됐지만 질문에 답할 근거가 부족합니다."
              : answer.claims.map((claim) => claim.text).join("\n"),
          procedure: answer.procedure,
          evidence:
            answer.status === "insufficient"
              ? []
              : candidates.filter((candidate) => ids.has(candidate.id)),
          confidence: answer.status,
          insufficientEvidence: answer.status === "insufficient",
          limitations: answer.limitations,
        };
      } catch (error) {
        if (error instanceof AppError) {
          result = {
            ...result,
            status: "unavailable",
            answer: error.message,
            confidence: null,
            insufficientEvidence: null,
            searchResults: [...candidates],
            limitations: ["AI 답변을 완료하지 못했습니다. 자료를 직접 확인하세요."],
          };
        } else throw error;
      }
    }
  }
  try {
    await transaction(async (db) => {
      await assertSession(db, ctx);
      for (const candidate of candidates) {
        const current = await db.query(
          `SELECT m.id FROM manuals m JOIN manual_versions v ON v.manual_id=m.id AND v.version=m.published_version JOIN sources s ON s.id=m.source_id JOIN source_revisions r ON r.id=v.source_revision_id WHERE m.id=$1 AND m.workspace_id=$2 AND v.id=$3 AND r.id=$4 AND s.revision=r.revision AND NOT m.needs_review AND ($5::uuid IS NULL OR m.id=$5) FOR SHARE OF m,s`,
          [
            candidate.manualId,
            ctx.workspaceId,
            candidate.manualVersionId,
            candidate.sourceRevisionId,
            ctx.manualId,
          ],
        );
        if (!current.rowCount)
          throw new AppError(
            "version_changed",
            409,
            "답변 생성 중 자료가 변경됐습니다. 다시 질문하세요.",
          );
      }
      if (!operationId) {
        const rows = await db.query(
          "INSERT INTO operation_requests(id,workspace_id,session_id,key,payload_hash,kind,status,result,lease_until) VALUES($1,$2,$3,$4,$5,'question','complete',$6,now()) ON CONFLICT(session_id,key) DO NOTHING RETURNING id",
          [newId(), ctx.workspaceId, ctx.sessionId, key, hash, JSON.stringify(result)],
        );
        if (!rows.rowCount)
          throw new AppError("request_pending", 409, "같은 요청이 이미 처리됐습니다.");
      }
      await db.query(
        "INSERT INTO question_runs(id,workspace_id,session_id,question,result) VALUES($1,$2,$3,$4,$5)",
        [result.id, ctx.workspaceId, ctx.sessionId, parsed.question, JSON.stringify(result)],
      );
      for (const candidate of result.evidence)
        await db.query(
          "INSERT INTO evidence(id,workspace_id,question_id,manual_id,manual_version_id,source_id,source_revision_id,paragraph_id,quote,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            candidate.id,
            ctx.workspaceId,
            result.id,
            candidate.manualId,
            candidate.manualVersionId,
            candidate.sourceId,
            candidate.sourceRevisionId,
            candidate.paragraphId,
            candidate.quote,
            candidate.kind,
          ],
        );
      if (operationId)
        await db.query("UPDATE operation_requests SET status='complete',result=$2 WHERE id=$1", [
          operationId,
          JSON.stringify(result),
        ]);
    });
    return result;
  } catch (error) {
    if (operationId && error instanceof AppError)
      await finishOperation(operationId, { errorCode: error.code });
    throw error;
  }
}
