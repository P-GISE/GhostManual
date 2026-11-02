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
type Result = z.infer<typeof resultSchema>;
type Turn = { id: string; question: string; result?: Result; error?: string };

function Answer({ result }: { readonly result: Result }) {
  return (
    <>
      <span className="badge">{statuses[result.status]}</span>
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
            {e.title} · {e.kind === "source" ? "원본" : "매뉴얼"} 버전 {e.version} · {e.paragraphId}
          </summary>
          <p className="source-text">{e.quote}</p>
        </details>
      ))}
      {!result.evidence.length && !result.searchResults.length && (
        <p className="muted">
          질문을 뒷받침할 자료를 찾지 못했습니다. 자료를 보완하거나 담당자에게 확인해 주세요.
        </p>
      )}
    </>
  );
}
// Chat-style thread: each question is answered on its own from the published manuals (no conversation memory yet).
export function QuestionForm({
  manualId,
  reader = false,
}: {
  readonly manualId?: string;
  readonly reader?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  async function send() {
    const text = question.trim();
    if (!text || busy) return;
    const id = crypto.randomUUID();
    setTurns((all) => [...all, { id, question: text }]);
    setQuestion("");
    setBusy(true);
    let update: Partial<Turn>;
    try {
      update = {
        result: resultSchema.parse(
          await http
            .post("/api/questions", {
              json: manualId ? { question: text, manualId } : { question: text },
              headers: {
                "idempotency-key": id,
                ...(reader ? { "x-ghost-role": "reader" } : {}),
              },
            })
            .json(),
        ),
      };
    } catch (e) {
      update = { error: await message(e) };
    }
    setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...update } : t)));
    setBusy(false);
  }
  return (
    <section className="chat">
      {turns.length > 0 && (
        <div className="chat-log" role="log" aria-label="질문과 답변" aria-live="polite">
          {turns.map((t) => (
            <article key={t.id} className="chat-turn">
              <p className="chat-question">{t.question}</p>
              <div className="chat-answer">
                {t.result ? (
                  <Answer result={t.result} />
                ) : t.error ? (
                  <p className="error" role="alert">
                    {t.error}
                  </p>
                ) : (
                  <p role="status">근거를 확인하고 있습니다…</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="question">업무 질문</label>
        <textarea
          id="question"
          required
          minLength={1}
          maxLength={1000}
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter adds a line; never while a Korean IME is still composing.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="예: 월말 정산은 어떤 순서로 진행하나요?"
          aria-describedby="question-help"
        />
        <p id="question-help" className="help">
          검수한 매뉴얼과 원본을 검색합니다. 확인할 수 없는 내용은 답변을 보류합니다. 여러 번 질문할
          수 있고, 각 질문은 따로 답합니다. Enter로 보내고 Shift+Enter로 줄을 바꿉니다.
        </p>
        <button type="submit" disabled={busy}>
          {busy ? "근거를 확인하고 있습니다…" : "근거 찾아 질문하기"}
        </button>
      </form>
    </section>
  );
}
