"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";

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
  understoodAs: z.string().nullable().default(null),
});
const statuses = {
  supported: "근거 확인",
  partial: "부분 근거",
  insufficient: "근거 부족",
  unavailable: "AI 답변 이용 불가",
} as const;
type Result = z.infer<typeof resultSchema>;
type Turn = { id: string; question: string; result?: Result; error?: string };
// 이 매뉴얼에서 한 질문의 id만 브라우저에 둔다. 질문과 답의 글은 서버의 세션 기록에서 다시 읽는다.
export const CHAT_STORAGE_PREFIX = "gm-chat:";
function storedIds(key: string): string[] {
  try {
    return z.array(z.string()).parse(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return [];
  }
}
function storeIds(key: string, ids: readonly string[]) {
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids.slice(-20)));
    else localStorage.removeItem(key);
  } catch {
    // 저장소를 쓸 수 없으면 대화가 새로고침 뒤에 이어지지 않을 뿐이다.
  }
}

function Answer({ result, reader }: { readonly result: Result; readonly reader: boolean }) {
  return (
    <>
      {result.understoodAs && (
        <p className="help chat-understood">이렇게 이해했습니다: {result.understoodAs}</p>
      )}
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
          {e.kind === "source" && (
            <Link href={`/sources/${e.sourceId}${reader ? "?view=shared" : ""}#${e.paragraphId}`}>
              원본 위치 보기
            </Link>
          )}
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
// Chat-style thread: a follow-up is understood from the last three answered turns; evidence is still only the published manuals.
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
  const storageKey = `${CHAT_STORAGE_PREFIX}${manualId ?? "all"}`;
  // 새로고침하거나 다른 화면에 다녀와도 이 세션에서 한 대화를 이어 보여 준다. 세션이 바뀌어 읽지 못한 것은 버린다.
  useEffect(() => {
    let active = true;
    void Promise.all(
      storedIds(storageKey).map((id) =>
        read(`/api/questions/${id}`, resultSchema, reader).catch(() => null),
      ),
    ).then((results) => {
      if (!active) return;
      const kept = results.filter((result) => result !== null);
      storeIds(
        storageKey,
        kept.map((result) => result.id),
      );
      setTurns((current) => [
        ...kept.map((result) => ({ id: result.id, question: result.question, result })),
        ...current,
      ]);
    });
    return () => {
      active = false;
    };
  }, [storageKey, reader]);
  // 플로팅 창에서는 대화만 스크롤되므로 새 질문과 답이 보이도록 맨 아래로 내린다.
  const log = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대화가 바뀔 때마다 다시 내려야 한다.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns]);
  function reset() {
    setTurns([]);
    storeIds(storageKey, []);
  }
  async function send() {
    const text = question.trim();
    if (!text || busy) return;
    const id = crypto.randomUUID();
    const after = turns.flatMap((turn) => (turn.result ? [turn.result.id] : [])).slice(-3);
    setTurns((all) => [...all, { id, question: text }]);
    setQuestion("");
    setBusy(true);
    let update: Partial<Turn>;
    try {
      update = {
        result: resultSchema.parse(
          await http
            .post("/api/questions", {
              json: {
                question: text,
                ...(manualId ? { manualId } : {}),
                ...(after.length ? { after } : {}),
              },
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
    if (update.result) storeIds(storageKey, [...storedIds(storageKey), update.result.id]);
    setBusy(false);
  }
  return (
    <section className="chat">
      {turns.length > 0 && (
        <div ref={log} className="chat-log" role="log" aria-label="질문과 답변" aria-live="polite">
          {turns.map((t) => (
            <article key={t.id} className="chat-turn">
              <p className="chat-question">{t.question}</p>
              <div className="chat-answer">
                {t.result ? (
                  <Answer result={t.result} reader={reader} />
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
          rows={2}
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
          검수한 매뉴얼과 원본을 검색합니다. 확인할 수 없는 내용은 답변을 보류합니다. 앞에서 물은
          것에 이어서 물을 수 있습니다. Enter로 보내고 Shift+Enter로 줄을 바꿉니다.
        </p>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "근거를 확인하고 있습니다…" : "근거 찾아 질문하기"}
          </button>
          {turns.length > 0 && (
            <button type="button" className="secondary" disabled={busy} onClick={reset}>
              새 대화
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
