"use client";
import { useState } from "react";
import { z } from "zod";
import { http, message } from "../lib/client";

const evidenceSchema = z.object({
  id: z.string(),
  manualId: z.string(),
  manualVersionId: z.string(),
  sourceId: z.string(),
  sourceRevisionId: z.string(),
  paragraphId: z.string(),
  quote: z.string(),
  title: z.string(),
  kind: z.enum(["source", "manual"]),
  version: z.number(),
});
const resultSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(["supported", "partial", "insufficient", "unavailable"]),
  answer: z.string(),
  procedure: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()) })),
  evidence: z.array(evidenceSchema),
  searchResults: z.array(evidenceSchema),
  confidence: z.enum(["supported", "partial", "insufficient"]).nullable(),
  insufficientEvidence: z.boolean().nullable(),
  limitations: z.array(z.string()),
  isOutdated: z.boolean(),
});
const statuses = {
  supported: "근거 확인",
  partial: "부분 근거",
  insufficient: "근거 부족",
  unavailable: "AI 답변 이용 불가",
} as const;
export function QuestionForm({
  manualId,
  reader = false,
}: {
  readonly manualId?: string;
  readonly reader?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<z.infer<typeof resultSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        resultSchema.parse(
          await http
            .post("/api/questions", {
              json: manualId ? { question, manualId } : { question },
              headers: {
                "idempotency-key": crypto.randomUUID(),
                ...(reader ? { "x-ghost-role": "reader" } : {}),
              },
            })
            .json(),
        ),
      );
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <form onSubmit={submit}>
        <label htmlFor="question">업무 질문</label>
        <textarea
          id="question"
          required
          minLength={1}
          maxLength={1000}
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 월말 정산은 어떤 순서로 진행하나요?"
          aria-describedby="question-help question-error"
        />
        <p id="question-help" className="help">
          검수한 매뉴얼과 원본을 검색합니다. 확인할 수 없는 내용은 답변을 보류합니다.
        </p>
        <button type="submit" disabled={busy}>
          {busy ? "근거를 확인하고 있습니다…" : "근거 찾아 질문하기"}
        </button>
      </form>
      {error && (
        <p className="error" id="question-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite">
          <h2>
            질문 결과 <span className="badge">{statuses[result.status]}</span>
          </h2>
          {result.isOutdated && (
            <p className="notice">이 답변 이후 자료가 변경됐습니다. 현재 버전을 확인하세요.</p>
          )}
          <p style={{ whiteSpace: "pre-wrap" }}>{result.answer}</p>
          {result.status === "unavailable" && (
            <p className="notice">
              AI를 사용할 수 없어 답변을 생성하지 않았습니다. 아래 검색 결과에서 직접 확인하세요.
            </p>
          )}
          {result.procedure.length > 0 && (
            <ol>
              {result.procedure.map((p) => (
                <li key={p.text}>{p.text}</li>
              ))}
            </ol>
          )}
          {result.limitations.length > 0 && (
            <>
              <h3>확인하지 못한 내용</h3>
              <ul>
                {result.limitations.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <h3>{result.status === "unavailable" ? "검색 결과" : "답변 근거"}</h3>
          {(result.status === "unavailable" ? result.searchResults : result.evidence).map((e) => (
            <details key={e.id}>
              <summary>
                {e.title} · {e.kind === "source" ? "원본" : "매뉴얼"} 버전 {e.version} ·{" "}
                {e.paragraphId}
              </summary>
              <p className="source-text">{e.quote}</p>
            </details>
          ))}
          {!result.evidence.length && !result.searchResults.length && (
            <p className="muted">
              질문을 뒷받침할 자료를 찾지 못했습니다. 자료를 보완하거나 담당자에게 확인해 주세요.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
