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
import { CellChanges } from "./CellChanges";
import { DocumentChanges } from "./DocumentChanges";

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
  block_added: "내용 추가",
  block_removed: "내용 삭제",
  block_modified: "내용 수정",
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
  limit_exceeded: "내용 비교에 제한이 있어 원본 확인이 필요합니다",
  pending: "문서 내용을 확인하고 있습니다. 완료 후 질문과 비교 결과를 표시합니다",
  failed: "문서를 처리하지 못했습니다. 원인을 확인하고 새 버전으로 다시 시도하세요",
  rejected: "안전 검사에서 거절된 파일입니다. 암호·매크로·손상 여부를 확인하세요",
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
  startUploading,
  busy,
  onBusyChange,
  onUploaded,
}: {
  readonly id: string;
  readonly reader: boolean;
  readonly startUploading: boolean;
  readonly busy: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onUploaded: (saved: FileRevision) => void;
}) {
  const [list, setList] = useState<RevisionSummary[]>([]);
  const [selected, setSelected] = useState<FileRevision | null>(null);
  const [sheet, setSheet] = useState(0);
  const [uploading, setUploading] = useState(startUploading);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const selectionRequest = useRef(0);
  const listRequest = useRef(0);
  const query = reader ? "?view=shared" : "";
  const readDetail = useCallback(
    async (revision: number, signal?: AbortSignal) =>
      fileRevisionSchema.parse(
        await http
          .get(`/api/sources/${id}/revisions/${revision}${query}`, {
            signal: signal ?? null,
            timeout: 15000,
            headers: reader ? { "x-ghost-role": "reader" } : {},
          })
          .json(),
      ),
    [id, query, reader],
  );
  const open = useCallback(
    async (revision: number) => {
      const request = ++selectionRequest.current;
      const detail = await readDetail(revision);
      if (request !== selectionRequest.current) return;
      setSelected(detail);
      onUploaded(detail);
      setSheet(0);
      setError("");
    },
    [readDetail, onUploaded],
  );
  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    const revisions = await read(
      `/api/sources/${id}/revisions${query}`,
      z.array(revisionSummarySchema),
      reader,
    );
    if (request !== listRequest.current) return [];
    setList(revisions);
    return revisions;
  }, [id, query, reader]);
  useEffect(() => {
    void refresh()
      .then((revisions) => (revisions[0] ? open(revisions[0].revision) : undefined))
      .catch(async (e) => setError(await message(e)));
  }, [refresh, open]);
  useEffect(() => {
    if (
      reader ||
      !selected ||
      !["queued", "processing"].includes(selected.extraction?.status ?? "")
    )
      return;
    let stopped = false;
    let inFlight = false;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void readDetail(selected.revision, controller.signal)
        .then((detail) => {
          if (stopped) return;
          setSelected((current) => (current?.revisionId === detail.revisionId ? detail : current));
          if (!["queued", "processing"].includes(detail.extraction?.status ?? "")) {
            setStatus(`v${detail.revision}: ${statusText[detail.compareStatus]}.`);
            onUploaded(detail);
            void refresh().catch(async (e) => {
              if (!stopped) setError(await message(e));
            });
          }
        })
        .catch(async (e) => {
          if (!stopped) setError(await message(e));
        })
        .finally(() => {
          inFlight = false;
        });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [reader, selected, readDetail, refresh, onUploaded]);
  async function retryExtraction() {
    if (!selected || busy || reader) return;
    onBusyChange(true);
    setError("");
    try {
      const saved = fileRevisionSchema.parse(
        await http
          .post(`/api/sources/${id}/revisions/${selected.revision}/retry`, {
            json: { expectedRevision: list[0]?.revision },
          })
          .json(),
      );
      onUploaded(saved);
      setSelected(saved);
      setStatus(`v${saved.revision}를 저장했습니다. 문서 확인이 끝날 때까지 기다려 주세요.`);
      await refresh();
    } catch (e) {
      setError(await message(e));
    } finally {
      onBusyChange(false);
    }
  }
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
      onUploaded(next);
      ++listRequest.current;
      const latest = revisionSummarySchema.parse({
        ...next,
        changeCount: next.changes.length,
        questionCount: next.questions.length,
        answeredCount: next.questions.filter((q) => q.answer !== null).length,
      });
      setList((current) =>
        current[0] && current[0].revision >= latest.revision ? current : [latest, ...current],
      );
      setSelected(next);
      setSheet(0);
      setUploading(false);
      setFile(null);
      setStatus(
        next.compareStatus === "compared"
          ? `v${next.revision}를 저장했습니다. 바뀐 부분 ${next.changes.length}건에 질문 ${next.questions.length}개를 만들었습니다. 연결된 매뉴얼은 재검토가 필요합니다.`
          : `v${next.revision}를 저장했습니다. ${statusText[next.compareStatus]}.`,
      );
      const request = ++selectionRequest.current;
      void readDetail(next.revision)
        .then(({ preview }) => {
          if (request !== selectionRequest.current) return;
          setSelected((current) =>
            current?.revisionId === next.revisionId ? { ...current, preview } : current,
          );
        })
        .catch(() => {
          if (request === selectionRequest.current)
            setError(
              `v${next.revision}는 저장됐지만 시트 미리보기를 불러오지 못했습니다. 버전 기록에서 다시 선택하세요.`,
            );
        });
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
  const document = !!selected && selected.fileType !== "xlsx";
  const extractionAllowed =
    !selected?.extraction || ["ready", "limited"].includes(selected.extraction.status);
  const uploadingType = selected?.fileType ?? "xlsx";
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
            <label htmlFor="revision-file">
              새 버전 {uploadingType === "xlsx" ? "엑셀" : "업무"} 파일
            </label>
            <input
              id="revision-file"
              type="file"
              accept={`.${uploadingType}`}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby="revision-help"
            />
            <p id="revision-help" className="help">
              .{uploadingType}, 5 MB까지. 직전 버전과 비교해 바뀐 부분을 질문합니다.
              {uploadingType === "xlsx"
                ? " AI가 켜져 있으면 자료 제목·시트 이름·수식·변경 위치와 개수가 AI(Anthropic Claude)로 전송됩니다. 첫 행을 포함한 셀 값과 원본 파일은 보내지 않습니다."
                : " 원본·추출 본문·표 값·OCR 결과는 자동으로 AI에 보내지 않습니다. 글꼴·배치·이미지는 비교하지 않습니다."}
              제목·설명·답변에 개인정보나 기밀이 없는지 확인하세요.
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
      {!reader && list.length === 1 && !uploading && (
        <p className="notice">
          다음에 이 파일 작업을 마치면 <strong>여기서 "새 버전 올리기"</strong>를 누르세요. 이전
          버전과 비교해 바뀐 부분을 물어봅니다. 자료 등록으로 다시 올리면 별개의 자료가 됩니다.
        </p>
      )}
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
              {document && !!selected.extraction?.coverage.length && (
                <details>
                  <summary>이 형식의 추출·비교 범위</summary>
                  <ul>
                    {selected.extraction.coverage.map((scope) => (
                      <li key={scope}>
                        {scope
                          .replace("spine", "문서 지정")
                          .replace("presentation", "슬라이드 지정")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {selected.aiSummary && (
                <p>
                  <span className="badge">AI 요약</span> {selected.aiSummary}
                </p>
              )}
              {extractionAllowed ? (
                <a
                  className="button secondary"
                  href={`/api/sources/${id}/revisions/${selected.revision}/file${query}`}
                >
                  v{selected.revision} 원본 내려받기
                </a>
              ) : (
                <p role="status">
                  {statusText[selected.compareStatus]}
                  {selected.extraction?.reason ? ` · ${selected.extraction.reason}` : ""}
                </p>
              )}
              {document && selected.extraction?.status === "limited" && (
                <p className="notice">
                  일부 내용만 처리돼 자동 비교를 완료하지 못했습니다. 원본을 직접 검토하고 제한
                  사항을 확인한 뒤 게시하세요.
                </p>
              )}
              {document &&
                !reader &&
                ["failed", "limited"].includes(selected.extraction?.status ?? "") && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={retryExtraction}
                  >
                    새 버전으로 다시 처리
                  </button>
                )}
            </section>
            {selected.revision > 1 &&
              extractionAllowed &&
              selected.compareStatus !== "limit_exceeded" && (
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
                          {typeof c.summary["count"] === "number"
                            ? ` · ${c.summary["count"]}칸`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!reader && !document && (
                    <CellChanges
                      key={selected.revision}
                      sourceId={id}
                      revision={selected.revision}
                    />
                  )}
                </section>
              )}
            {document && !reader && extractionAllowed && (
              <DocumentChanges
                key={selected.revisionId}
                sourceId={id}
                revision={selected.revision}
              />
            )}
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
            {shown && (
              <section className="panel" aria-labelledby="preview-title">
                <h2 id="preview-title">시트 미리보기</h2>
                <details>
                  <summary>펼쳐서 보기 · 시트 {selected.preview.length}개</summary>
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
                </details>
                <p className="help">원본은 브라우저에서 열지 않고 내려받기만 합니다.</p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
