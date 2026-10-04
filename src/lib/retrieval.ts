import { z } from "zod";
import { type EvidenceCandidate, EvidenceCandidateSchema } from "./ai-schemas.ts";
import { transaction } from "./db.ts";
import { assertSession } from "./session.ts";
import { newId, type SessionContext } from "./types.ts";
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
const synonyms = [
  ["승인", "결재"],
  ["마감", "기한"],
  ["오류", "실패"],
  ["담당", "책임"],
  ["수정", "변경"],
  ["저장", "보관"],
  ["매달", "월별"],
] as const;
export function searchTerms(question: string): string[] {
  const words = question
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) =>
      word.replace(/(인가요|하나요|해야|하는|은|는|을|를|이|가|에|에서|자는|자)$/u, ""),
    );
  const terms = new Set(
    words.filter(
      (word) =>
        word.length >= 2 && !/^(어떻게|누구|언제|무엇|알려|주세요|방법|있나요|하나요)$/.test(word),
    ),
  );
  for (const pair of synonyms)
    if (pair.some((word) => [...terms].some((term) => term.includes(word))))
      for (const word of pair) terms.add(word);
  return [...terms];
}
export function selectContext(candidates: readonly EvidenceCandidate[]): EvidenceCandidate[] {
  let size = 0;
  const result: EvidenceCandidate[] = [];
  for (const candidate of candidates) {
    if (result.length === 6) break;
    if (size + candidate.quote.length > 12000) continue;
    result.push(candidate);
    size += candidate.quote.length;
  }
  return result;
}
export async function retrieve(
  ctx: SessionContext,
  question: string,
  manualId?: string,
): Promise<readonly EvidenceCandidate[]> {
  const terms = searchTerms(question);
  if (!terms.length) return [];
  return transaction(async (db) => {
    await assertSession(db, ctx);
    const rows = await db.query<Record<string, unknown>>(
      `WITH eligible AS (
 SELECT m.id AS manual_id,v.id AS version_id,m.source_id,v.source_revision_id,v.version,v.content,r.title,r.text
 FROM manuals m JOIN manual_versions v ON v.manual_id=m.id AND v.version=m.published_version
 JOIN source_revisions r ON r.id=v.source_revision_id JOIN sources s ON s.id=m.source_id
 WHERE m.workspace_id=$1 AND m.published_version IS NOT NULL AND NOT m.needs_review AND s.revision=r.revision
 AND ($2::uuid IS NULL OR m.id=$2) AND ($3::uuid IS NULL OR m.id=$3)
 ), chunks AS (
 SELECT e.*,p.quote,p.ordinality,'source' AS kind FROM eligible e CROSS JOIN LATERAL regexp_split_to_table(e.text,E'\\n\\s*\\n') WITH ORDINALITY p(quote,ordinality)
 UNION ALL
 SELECT e.*,p.quote,p.ordinality,'manual' AS kind FROM eligible e CROSS JOIN LATERAL jsonb_array_elements_text(
 jsonb_build_array(e.content->>'purpose',e.content->>'trigger',e.content->>'cadence',e.content->>'ownerRole',e.content->>'completion') || (e.content->'steps') || (e.content->'warnings') || (e.content->'exceptions') || (e.content->'resources') || (e.content->'systems')) WITH ORDINALITY p(quote,ordinality)
 ), ranked AS (
 SELECT *, (SELECT count(*) FROM unnest($4::text[]) term WHERE regexp_replace(lower(normalize(quote,NFKC)),'[^a-z0-9가-힣]','','g') LIKE '%'||term||'%') AS hits,
 similarity(regexp_replace(lower(normalize(quote,NFKC)),'[^a-z0-9가-힣]','','g'),$5) AS fuzzy FROM chunks WHERE quote IS NOT NULL AND length(quote)>0 AND length(quote)<=12000
 ) SELECT manual_id AS "manualId",version_id AS "manualVersionId",source_id AS "sourceId",source_revision_id AS "sourceRevisionId",version,title,quote,kind,'p'||ordinality AS "paragraphId"
 FROM ranked WHERE hits>0 OR fuzzy>=0.25 ORDER BY hits DESC,fuzzy DESC,kind ASC,manual_id,ordinality LIMIT 20`,
      [ctx.workspaceId, manualId ?? null, ctx.manualId, terms, normalizeSearch(question)],
    );
    return selectContext(
      rows.rows.map((row) =>
        EvidenceCandidateSchema.parse({
          ...row,
          id: newId(),
          version: z.number().parse(row["version"]),
        }),
      ),
    );
  });
}
