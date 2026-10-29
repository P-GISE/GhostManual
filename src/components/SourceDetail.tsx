"use client";
import { HTTPError } from "ky";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, manualSchema, message, read, type Source, sourceSchema } from "../lib/client";
import { type ManualDraft, SourceInputSchema } from "../lib/schemas";
import { SourceDelete } from "./SourceDelete";
import { useUnsavedChanges } from "./useUnsavedChanges";
export function SourceDetail({ id }: { readonly id: string }) {
  const router = useRouter();
  const [reader, setReader] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
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
      const draft: ManualDraft = {
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
              json: { expectedRevision: source.revision },
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
        {!reader && (
          <aside className="panel">
            <h2>매뉴얼 만들기</h2>
            <p>업무 목적과 순서, 주의 사항을 정리한 다음 직접 검수합니다.</p>
            <div className="actions">
              <button type="button" onClick={() => create(false)} disabled={busy || editing}>
                직접 작성하기
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => create(true)}
                disabled={busy || editing}
              >
                AI 초안 요청
              </button>
            </div>
            <p className="help">
              AI가 비활성화됐거나 연결할 수 없으면 생성 불가 안내를 표시합니다. 합성 예제는 미리
              작성된 문서입니다.
            </p>
            {busy && <p role="status">요청을 처리하고 있습니다.</p>}
            <SourceDelete
              confirmed={deleteConfirmed}
              disabled={busy || editing}
              onConfirm={setDeleteConfirmed}
              onDelete={remove}
            />
          </aside>
        )}
      </div>
    </>
  );
}
