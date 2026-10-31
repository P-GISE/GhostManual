"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  type FileRevision,
  fileRevisionSchema,
  fileSize,
  http,
  kst,
  message,
  type Question,
  questionResultSchema,
  type RevisionSummary,
  read,
  revisionSummarySchema,
} from "../lib/client";

export const changeLabels: Record<string, string> = {
  sheet_added: "시트 추가",
  sheet_removed: "시트 삭제",
  formula_added: "수식 추가",
  formula_changed: "수식 변경",
  formula_removed: "수식 삭제",
  filter_changed: "필터 변경",
  names_changed: "이름 정의 변경",
  size_changed: "행·열 수 변경",
  values_changed: "값 변경",
};
const questionLabels: Record<string, string> = {
  purpose: "업무 목적",
  origin: "자료 출처",
  other: "기타 변경",
};
const statusText: Record<FileRevision["compareStatus"], string> = {
  first: "처음 올린 버전",
  compared: "직전 버전과 비교함",
  no_changes: "직전 버전과 내용이 같습니다",
  limit_exceeded: "시트·셀이 많아 내용 비교를 하지 않았습니다",
};
export const who = (r: { uploadedByName: string | null; uploadedByDepartment: string | null }) =>
  r.uploadedByName
    ? `${r.uploadedByName}${r.uploadedByDepartment ? ` (${r.uploadedByDepartment})` : ""}`
    : "기록 없음";

function QuestionCard({
  question,
  label,
  readOnly,
  save,
}: {
  readonly question: Question;
  readonly label: string;
  readonly readOnly: boolean;
  readonly save: (body: { answer: string } | { skipped: true }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(question.answer === null && !question.skipped);
  const [answer, setAnswer] = useState(question.answer ?? "");
  const [busy, setBusy] = useState(false);
  const id = `answer-${question.id}`;
  async function submit(body: { answer: string } | { skipped: true }) {
    setBusy(true);
    try {
      if (await save(body)) setEditing(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="question-card" aria-label={question.question}>
      <div className="question-meta">
        <span className="help">{label}</span>
        {question.source === "ai" && <span className="badge">AI가 만든 질문</span>}
      </div>
      <p className="question-text">{question.question}</p>
      {editing && !readOnly ? (
        <>
          <label htmlFor={id}>답변</label>
          <textarea
            id={id}
            disabled={busy}
            rows={3}
            maxLength={2000}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="actions">
            <button
              type="button"
              disabled={busy || !answer.trim()}
              onClick={() => submit({ answer: answer.trim() })}
            >
              답변 저장
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => submit({ skipped: true })}
            >
              건너뛰기
            </button>
          </div>
        </>
      ) : (
        <>
          {question.answer !== null ? (
            <p className="answer">{question.answer}</p>
          ) : (
            <p className="help">
              {question.skipped ? "건너뜀 · 매뉴얼 확인 필요 항목에 남습니다" : "답변 없음"}
            </p>
          )}
          {!readOnly && (
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setEditing(true)}>
                {question.answer !== null ? "고치기" : "답하기"}
              </button>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}

export function FileVersions({
  id,
  reader,
  busy,
  onBusyChange,
  onUploaded,
}: {
  readonly id: string;
  readonly reader: boolean;
  readonly busy: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onUploaded: () => Promise<void>;
}) {
  const [list, setList] = useState<RevisionSummary[]>([]);
  const [selected, setSelected] = useState<FileRevision | null>(null);
  const [sheet, setSheet] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const selectionRequest = useRef(0);
  const query = reader ? "?view=shared" : "";
  const open = useCallback(
    async (revision: number) => {
      const request = ++selectionRequest.current;
      const detail = await read(
        `/api/sources/${id}/revisions/${revision}${query}`,
        fileRevisionSchema,
        reader,
      );
      if (request !== selectionRequest.current) return;
      setSelected(detail);
      setSheet(0);
    },
    [id, query, reader],
  );
  const refresh = useCallback(async () => {
    const revisions = await read(
      `/api/sources/${id}/revisions${query}`,
      z.array(revisionSummarySchema),
      reader,
    );
    setList(revisions);
    return revisions;
  }, [id, query, reader]);
  useEffect(() => {
    void refresh()
      .then((revisions) => (revisions[0] ? open(revisions[0].revision) : undefined))
      .catch(async (e) => setError(await message(e)));
  }, [refresh, open]);
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file || !list[0]) return;
    onBusyChange(true);
    setError("");
    setStatus("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("expectedRevision", String(list[0].revision));
      const next = fileRevisionSchema.parse(
        await http.post(`/api/sources/${id}/revisions`, { body, timeout: 60000 }).json(),
      );
      await onUploaded();
      await refresh();
      await open(next.revision);
      setUploading(false);
      setFile(null);
      setStatus(
        next.compareStatus === "compared"
          ? `v${next.revision}를 저장했습니다. 바뀐 부분 ${next.changes.length}건에 질문 ${next.questions.length}개를 만들었습니다. 연결된 매뉴얼은 재검토가 필요합니다.`
          : `v${next.revision}를 저장했습니다. ${statusText[next.compareStatus]}.`,
      );
    } catch (e) {
      setError(await message(e));
    } finally {
      onBusyChange(false);
    }
  }
  async function answer(question: Question, body: { answer: string } | { skipped: true }) {
    if (!selected) return false;
    const request = selectionRequest.current;
    setError("");
    try {
      const updated = questionResultSchema.parse(
        await http
          .put(`/api/sources/${id}/revisions/${selected.revision}/questions/${question.id}`, {
            json: body,
          })
          .json(),
      );
      setSelected((current) =>
        request === selectionRequest.current && current?.revisionId === selected.revisionId
          ? {
              ...current,
              questions: current.questions.map((q) => (q.id === updated.id ? updated : q)),
            }
          : current,
      );
      void refresh().catch(async (e) => setError(await message(e)));
      return true;
    } catch (e) {
      if (request === selectionRequest.current) setError(await message(e));
      return false;
    }
  }
  const label = (q: Question) =>
    questionLabels[q.kind] ??
    q.groupPositions.map((p) => changeLabels[selected?.changes[p]?.kind ?? ""] ?? "").join(" · ");
  const shown = selected?.preview[sheet];
  return (
    <div className="file-versions">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
      {!reader &&
        (uploading ? (
          <form className="panel" onSubmit={upload}>
            <h2>새 버전 올리기</h2>
            <label htmlFor="revision-file">새 버전 엑셀 파일</label>
            <input
              id="revision-file"
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby="revision-help"
            />
            <p id="revision-help" className="help">
              .xlsx, 5 MB까지. 직전 버전과 비교해 바뀐 부분을 질문합니다. AI가 켜져 있으면 자료
              제목·시트 이름·첫 행의 열 이름·수식·변경 위치와 개수가 AI(Anthropic Claude)로
              전송됩니다. 일반 데이터 셀 값과 원본 파일은 보내지 않습니다. 제목·머리글·수식에
              개인정보가 들어 있지 않은지 확인하세요.
            </p>
            <div className="actions">
              <button type="submit" disabled={busy || !file || !list[0]}>
                {busy ? "비교하고 있습니다…" : "올리고 비교하기"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setUploading(false)}
              >
                취소
              </button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button type="button" disabled={busy || !list[0]} onClick={() => setUploading(true)}>
              새 버전 올리기
            </button>
          </div>
        ))}
      <div className="version-layout">
        <section className="panel" aria-labelledby="versions-title">
          <h2 id="versions-title">버전 기록</h2>
          <ul className="version-list">
            {list.map((r) => (
              <li key={r.revision}>
                <button
                  type="button"
                  className="version-item"
                  aria-current={selected?.revision === r.revision ? "true" : undefined}
                  onClick={() =>
                    void open(r.revision).catch(async (e) => setError(await message(e)))
                  }
                >
                  <strong>
                    v{r.revision}
                    {r.revision === list[0]?.revision ? " · 최신" : ""}
                  </strong>
                  <span>
                    {kst(r.createdAt)} · {who(r)}
                  </span>
                  <span>
                    {r.file.name} · {fileSize(r.file.sizeBytes)}
                  </span>
                  <span>
                    {r.compareStatus === "compared" ? `바뀐 부분 ${r.changeCount}건 · ` : ""}
                    질문 {r.answeredCount}/{r.questionCount} 답함
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="help">이름·소속은 올릴 당시 프로필 값으로 고정됩니다.</p>
        </section>
        {selected && (
          <div className="version-detail">
            <section className="panel">
              <h2>버전 {selected.revision}</h2>
              <p className="muted">
                {kst(selected.createdAt)} · {who(selected)} · {selected.file.name} (
                {fileSize(selected.file.sizeBytes)}) · {statusText[selected.compareStatus]}
              </p>
              {selected.aiSummary && (
                <p>
                  <span className="badge">AI 요약</span> {selected.aiSummary}
                </p>
              )}
              <a
                className="button secondary"
                href={`/api/sources/${id}/revisions/${selected.revision}/file${query}`}
              >
                v{selected.revision} 원본 내려받기
              </a>
            </section>
            <section className="panel" aria-labelledby="questions-title">
              <h2 id="questions-title">이번 버전 질문</h2>
              {selected.questions.length ? (
                <>
                  <p className="help">
                    {selected.questions.length}개 중{" "}
                    {selected.questions.filter((q) => q.answer !== null).length}개 답함 · 답하지
                    않은 질문은 매뉴얼 "확인 필요"에 남습니다.
                  </p>
                  {selected.questions.map((q) => (
                    <QuestionCard
                      key={`${q.id}-${q.answer}-${q.skipped}`}
                      question={q}
                      label={label(q)}
                      readOnly={reader}
                      save={(body) => answer(q, body)}
                    />
                  ))}
                </>
              ) : (
                <p className="help">질문이 없습니다.</p>
              )}
            </section>
            {selected.revision > 1 && (
              <section className="panel" aria-labelledby="changes-title">
                <h2 id="changes-title">
                  v{selected.revision - 1}과 비교해 바뀐 부분 {selected.changes.length}건
                </h2>
                <ul className="change-list">
                  {selected.changes.map((c) => (
                    <li key={c.position}>
                      <strong>{changeLabels[c.kind] ?? c.kind}</strong>
                      <span>
                        {c.sheet ? `'${c.sheet}'` : ""} {c.range ?? ""}
                        {typeof c.summary["count"] === "number" ? ` · ${c.summary["count"]}칸` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {shown && (
              <section className="panel" aria-labelledby="preview-title">
                <h2 id="preview-title">시트 미리보기</h2>
                <div className="actions">
                  {selected.preview.map((p, index) => (
                    <button
                      key={p.sheet}
                      type="button"
                      className={index === sheet ? "" : "secondary"}
                      aria-pressed={index === sheet}
                      onClick={() => setSheet(index)}
                    >
                      {p.sheet}
                    </button>
                  ))}
                </div>
                <div className="table-scroll">
                  <table>
                    <caption className="help">
                      '{shown.sheet}' 앞쪽 20행 × 12열 · 전체 {shown.rows}행 × {shown.cols}열
                    </caption>
                    <tbody>
                      {shown.cells.map((row, r) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no identity
                        <tr key={r}>
                          {row.map((cell, c) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: preview cells have no identity
                            <td key={c}>{cell === null ? "" : String(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="help">원본은 브라우저에서 열지 않고 내려받기만 합니다.</p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
