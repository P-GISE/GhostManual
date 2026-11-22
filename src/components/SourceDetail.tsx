"use client";
import { HTTPError } from "ky";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  type FileRevision,
  fileTypeLabels,
  http,
  manualSchema,
  message,
  read,
  type Source,
  sourceSchema,
} from "../lib/client";
import { type ManualDraft, SourceInputSchema } from "../lib/schemas";
import { FileVersions } from "./FileVersions";
import { SourceDelete } from "./SourceDelete";
import { SourceMove } from "./SourceMove";
import { switchWorkspace } from "./Teams";
import { useUnsavedChanges } from "./useUnsavedChanges";

const readyTemplatesSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    isDefault: z.boolean(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        guide: z.string(),
        kind: z.enum(["text", "list"]),
      }),
    ),
  }),
);
export function SourceDetail({
  id,
  upload = false,
}: {
  readonly id: string;
  readonly upload?: boolean;
}) {
  const router = useRouter();
  const [reader, setReader] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [movedTarget, setMovedTarget] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  // 확정된 양식이 있으면 "매뉴얼 만들기"에서 고른다. 기본 양식이 먼저 선택돼 있다.
  const [templates, setTemplates] = useState<z.infer<typeof readyTemplatesSchema>>([]);
  const [templateId, setTemplateId] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState("");
  const [templateAttempt, setTemplateAttempt] = useState(0);
  const sourceReady = source?.id === id;
  useEffect(() => {
    if (id !== source?.id) setMovedTarget("");
  }, [id, source?.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 재시도 버튼이 같은 목록 요청을 다시 실행한다.
  useEffect(() => {
    if (reader || !sourceReady) return;
    let active = true;
    const controller = new AbortController();
    setTemplatesLoading(true);
    setTemplatesError("");
    http
      .get("/api/templates?ready=1", { timeout: 10000, signal: controller.signal })
      .json()
      .then((value) => {
        const list = readyTemplatesSchema.parse(value);
        if (!active) return;
        setTemplates(list);
        setTemplateId(list.find((entry) => entry.isDefault)?.id ?? "");
      })
      .catch(async (error) => {
        const detail = await message(error);
        if (active) setTemplatesError(`양식 목록을 불러오지 못했습니다. ${detail}`);
      })
      .finally(() => {
        if (active) setTemplatesLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reader, sourceReady, templateAttempt]);
  const updateFile = useCallback(
    ({ revision, revisionId, fileType, extraction }: FileRevision) =>
      setSource((current) =>
        current?.id === id && revision >= current.revision
          ? { ...current, revision, revisionId, fileType, extraction }
          : current,
      ),
    [id],
  );
  useUnsavedChanges(editing && !!source && (title !== source.title || text !== source.text));
  useEffect(() => {
    async function load() {
      const sessionSchema = z.object({ role: z.enum(["owner", "reader"]) });
      // Shared readers are signed in too, so the shared view is chosen explicitly by the link.
      let readOnly = new URLSearchParams(window.location.search).get("view") === "shared";
      if (readOnly) await read("/api/session", sessionSchema, true);
      else
        try {
          await read("/api/session", sessionSchema);
        } catch (error) {
          if (!(error instanceof HTTPError) || error.response.status !== 401) throw error;
          await read("/api/session", sessionSchema, true);
          readOnly = true;
        }
      const current = await read(`/api/sources/${id}`, sourceSchema, readOnly);
      setReader(readOnly);
      setSource(current);
      setTitle(current.title);
      setText(current.text);
    }
    void load().catch(async (error) => setError(await message(error)));
  }, [id]);
  async function save() {
    if (!source) return;
    const input = SourceInputSchema.safeParse({ title, text });
    if (!input.success) {
      setError("제목은 1~120자, 본문은 100~20,000자로 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      const s = sourceSchema.parse(
        await http
          .patch(`/api/sources/${id}`, {
            json: { ...input.data, expectedRevision: source.revision },
          })
          .json(),
      );
      setSource(s);
      setEditing(false);
    } catch (e) {
      setError(await message(e));
    } finally {
      setBusy(false);
    }
  }
  async function create(generate: boolean) {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      if (!generate) {
        const existing = (await read("/api/manuals", z.array(manualSchema))).find(
          (manual) => manual.sourceId === id,
        );
        if (existing) {
          router.push(`/manuals/${existing.id}/edit`);
          return;
        }
      }
      if (templatesLoading || templatesError) {
        setError(
          "새 매뉴얼을 만들려면 양식 목록을 불러온 뒤 다시 시도하세요. 기존 매뉴얼은 직접 작성하기로 열 수 있습니다.",
        );
        setBusy(false);
        return;
      }
      const chosen = templates.find((entry) => entry.id === templateId);
      const draft: ManualDraft = chosen
        ? {
            title: source.title,
            template: { id: chosen.id, name: chosen.name },
            sections: chosen.items.map((item) => ({
              ...item,
              text: null,
              items: [],
              state: "empty" as const,
              by: "human" as const,
            })),
            unknowns: ["담당자가 내용을 작성하고 원본 근거를 확인해야 합니다."],
            references: [],
          }
        : {
            title: source.title,
            purpose: null,
            trigger: null,
            cadence: null,
            ownerRole: null,
            resources: [],
            systems: [],
            steps: [],
            warnings: [],
            exceptions: [],
            completion: null,
            unknowns: ["담당자가 내용을 작성하고 원본 근거를 확인해야 합니다."],
            references: [],
          };
      const result = generate
        ? await http
            .post(`/api/sources/${id}/generate`, {
              json: { expectedRevision: source.revision, templateId: templateId || null },
              headers: { "idempotency-key": crypto.randomUUID() },
            })
            .json()
        : await http
            .post("/api/manuals", { json: { sourceRevisionId: source.revisionId, draft } })
            .json();
      if (generate) {
        const generated = z
          .union([
            z.object({ manual: manualSchema, operationId: z.string() }),
            z.object({ processing: z.literal(true), operationId: z.string() }),
          ])
          .parse(result);
        if ("processing" in generated) {
          setError("이미 초안을 생성하고 있습니다. 잠시 후 문서함에서 확인하세요.");
          setBusy(false);
          return;
        }
        router.push(`/manuals/${generated.manual.id}/edit`);
      } else router.push(`/manuals/${manualSchema.parse(result).id}/edit`);
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleteConfirmed) return;
    setBusy(true);
    setError("");
    try {
      await http.delete(`/api/sources/${id}`);
      router.push("/manuals");
    } catch (error) {
      setError(await message(error));
      setBusy(false);
    }
  }
  if (movedTarget)
    return (
      <section aria-label="업무 이동 완료">
        <h1>팀 문서함으로 옮겼습니다</h1>
        <p>관련 AI 질문 기록은 삭제됐습니다. 공유 링크는 계속 사용할 수 있습니다.</p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await switchWorkspace(movedTarget, `/sources/${id}`);
            } catch (error) {
              setError(await message(error));
              setBusy(false);
            }
          }}
        >
          팀 문서함에서 열기
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
    );
  if (!source)
    return (
      <>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">원본을 불러오고 있습니다.</p>
        )}
      </>
    );
  const sourceBlocked =
    !!source.extraction && !["ready", "limited"].includes(source.extraction.status);
  const sourceLabel = fileTypeLabels[source.fileType ?? "xlsx"] ?? "업무 파일";
  const manualPanel = reader ? null : (
    <aside className="panel">
      <h2>매뉴얼 만들기</h2>
      <p>업무 목적과 순서, 주의 사항을 정리한 다음 직접 검수합니다.</p>
      {templatesLoading && <p role="status">양식 목록을 불러오고 있습니다.</p>}
      {templatesError && (
        <div className="notice">
          <p role="alert">{templatesError}</p>
          <button
            type="button"
            className="secondary"
            disabled={templatesLoading || busy}
            onClick={() => {
              setTemplatesLoading(true);
              setError("");
              setTemplateAttempt((attempt) => attempt + 1);
            }}
          >
            양식 목록 다시 불러오기
          </button>
        </div>
      )}
      {!templatesLoading && !templatesError && templates.length > 0 && (
        <>
          <label htmlFor="manual-template">매뉴얼 항목</label>
          <select
            id="manual-template"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                양식: {entry.name}
              </option>
            ))}
            <option value="">기본 항목(양식 없음)</option>
          </select>
        </>
      )}
      <div className="actions">
        <button
          type="button"
          onClick={() => create(false)}
          disabled={busy || editing || sourceBlocked}
        >
          직접 작성하기
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => create(true)}
          disabled={
            busy ||
            editing ||
            sourceBlocked ||
            templatesLoading ||
            !!templatesError ||
            source.extraction?.status === "limited"
          }
        >
          AI 초안 요청
        </button>
      </div>
      <p className="help">
        {source.kind === "file" && source.fileType !== "xlsx" && source.fileType !== null
          ? "문서 원본·추출 본문·표 값·OCR 결과는 자동으로 AI에 보내지 않습니다. 자료 제목·구조·변경 위치와 작성한 답변으로 초안을 만듭니다. 설명·답변에 개인정보나 기밀이 없는지 확인하세요."
          : source.kind === "file"
            ? "자료 제목·시트 구조·변경 수식·버전별 질문과 답변을 AI에 보내 초안을 만듭니다. 제목·시트 이름·수식·답변에 개인정보나 기밀이 없는지 확인하세요. 첫 행을 포함한 셀 값과 원본 파일은 보내지 않습니다. 답하지 않은 질문은 확인 필요 항목으로 남습니다."
            : "AI가 비활성화됐거나 연결할 수 없으면 생성 불가 안내를 표시합니다. 합성 예제는 미리 작성된 문서입니다."}
      </p>
      {sourceBlocked && (
        <p className="notice" role="status">
          문서 확인이 완료되기 전에는 매뉴얼을 만들거나 게시할 수 없습니다.
        </p>
      )}
      {!reader && (
        <SourceMove id={id} disabled={busy || editing} onBusy={setBusy} onMoved={setMovedTarget} />
      )}
      {busy && <p role="status">요청을 처리하고 있습니다.</p>}
      {source.canDelete ? (
        <SourceDelete
          confirmed={deleteConfirmed}
          disabled={busy || editing}
          onConfirm={setDeleteConfirmed}
          onDelete={remove}
        />
      ) : (
        <p className="help">이 업무는 올린 사람과 팀 관리자만 삭제할 수 있습니다.</p>
      )}
    </aside>
  );
  if (source.kind === "file")
    return (
      <>
        <span className="eyebrow">
          {sourceLabel} 자료 · 버전 {source.revision}개
        </span>
        <h1>{source.title}</h1>
        <p className="muted">
          {reader
            ? "공유 매뉴얼에 연결된 파일 버전입니다. 읽기 전용으로 확인할 수 있습니다."
            : "작업을 마친 파일을 새 버전으로 올리면 바뀐 부분을 질문합니다. 새 버전은 연결된 매뉴얼의 재검토가 필요합니다."}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <FileVersions
          id={id}
          reader={reader}
          startUploading={upload}
          busy={busy}
          onBusyChange={setBusy}
          onUploaded={updateFile}
        />
        {manualPanel}
      </>
    );
  return (
    <>
      <span className="eyebrow">원본 자료 · 버전 {source.revision}</span>
      <h1>{source.title}</h1>
      <p className="muted">
        {reader
          ? "공유 매뉴얼에 연결된 원본입니다. 읽기 전용으로 확인할 수 있습니다."
          : "원본을 수정하면 연결된 매뉴얼은 재검토가 필요합니다."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="split">
        <section className="document">
          {editing ? (
            <>
              <label htmlFor="title">제목</label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
              <label htmlFor="text">원본 내용</label>
              <textarea
                id="text"
                rows={18}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="actions">
                <button type="button" onClick={save} disabled={busy}>
                  새 원본 버전 저장
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (title !== source.title || text !== source.text) {
                      if (!window.confirm("저장하지 않은 입력을 닫으시겠습니까?")) return;
                    }
                    setTitle(source.title);
                    setText(source.text);
                    setEditing(false);
                  }}
                >
                  닫기
                </button>
              </div>
            </>
          ) : (
            <>
              {source.text
                .split(/\n\s*\n/)
                .filter((p) => p.trim())
                .map((p, i) => (
                  <section key={p} id={`p${i + 1}`}>
                    <span className="help">문단 p{i + 1}</span>
                    <p>{p}</p>
                  </section>
                ))}
              {!reader && (
                <button type="button" className="secondary" onClick={() => setEditing(true)}>
                  원본 수정
                </button>
              )}
            </>
          )}
        </section>
        {manualPanel}
      </div>
    </>
  );
}
