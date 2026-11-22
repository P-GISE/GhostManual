"use client";
import { HTTPError } from "ky";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, message } from "../lib/client";
import { templateStatusText } from "./TemplateList";
import { useUnsavedChanges } from "./useUnsavedChanges";

const itemShape = { name: z.string(), guide: z.string(), kind: z.enum(["text", "list"]) };
const templateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(["reading", "review", "ready", "failed"]),
  extraction: z
    .object({
      warnings: z.array(z.string()),
      candidates: z.array(z.object({ candidateId: z.string(), name: z.string() })),
    })
    .nullable(),
  items: z.array(z.object({ id: z.string().optional(), ...itemShape })),
  isDefault: z.boolean(),
});
type Template = z.infer<typeof templateSchema>;
type Item = Template["items"][number];
export function TemplateDetail({ id }: { readonly id: string }) {
  const router = useRouter();
  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  // 체크를 푼 후보. 처음에는 모두 체크돼 있다.
  const [unchecked, setUnchecked] = useState<readonly string[]>([]);
  // 편집 중인 항목. null이면 후보 확인 단계다.
  const [items, setItems] = useState<Item[] | null>(null);
  const [saved, setSaved] = useState("");
  useUnsavedChanges(
    !!template &&
      items !== null &&
      (template.status !== "ready" || JSON.stringify(items) !== JSON.stringify(template.items)),
  );
  const reading = !template || template.status === "reading";
  useEffect(() => {
    if (!reading) return;
    const controller = new AbortController();
    let stopped = false;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      http
        .get(`/api/templates/${id}`, { timeout: 10000, signal: controller.signal })
        .json()
        .then((data) => templateSchema.parse(data))
        .then((current) => {
          if (stopped) return;
          setTemplate(current);
          setError("");
          if (current.status === "ready") setItems(current.items);
        })
        .catch(async (e) => {
          const text = await message(e);
          if (!stopped) setError(text);
          if (e instanceof HTTPError && [401, 403, 404].includes(e.response.status))
            clearInterval(timer);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    // 추출은 워커가 따로 처리하므로 끝날 때까지 2초마다 상태를 다시 읽는다.
    const timer = setInterval(load, 2000);
    load();
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [id, reading]);
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await http.delete(`/api/templates/${id}`).json();
      router.push("/templates");
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  async function send(work: () => Promise<void>, hint = "") {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await work();
    } catch (e) {
      setError((await message(e)) + hint);
    } finally {
      setBusy(false);
    }
  }
  const organize = (candidateIds: string[]) =>
    send(async () => {
      const draft = z
        .object({ items: z.array(z.object(itemShape)) })
        .parse(await http.post(`/api/templates/${id}/read`, { json: { candidateIds } }).json());
      setItems(draft.items);
      if (!draft.items.length) setError("AI가 항목을 찾지 못했습니다. 항목을 직접 입력하세요.");
    }, " 항목을 직접 입력할 수 있습니다.");
  const patch = (json: object, done: string) =>
    send(async () => {
      const current = templateSchema.parse(
        await http.patch(`/api/templates/${id}`, { json }).json(),
      );
      setTemplate(current);
      if ("items" in json) setItems(current.items);
      setSaved(done);
    });
  if (!template)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="loading" role="status">
        양식을 불러오고 있습니다.
      </p>
    );
  const candidates = template.extraction?.candidates ?? [];
  const checked = candidates
    .map((candidate) => candidate.candidateId)
    .filter((candidateId) => !unchecked.includes(candidateId));
  const edit = (index: number, change: Partial<Item>) =>
    setItems((items ?? []).map((item, at) => (at === index ? { ...item, ...change } : item)));
  const move = (index: number, to: number) => {
    const next = [...(items ?? [])];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(to, 0, moved);
    setItems(next);
  };
  return (
    <>
      <Link href="/templates">양식 목록</Link>
      <h1>{template.name}</h1>
      <p>
        <span className="badge">{templateStatusText[template.status]}</span>{" "}
        {template.isDefault && <span className="badge">기본 양식</span>}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="notice" role="status">
          {saved}
        </p>
      )}
      {template.status === "reading" && (
        <p className="loading" role="status">
          양식에서 항목 후보를 꺼내고 있습니다. 이 화면을 열어 두면 끝났을 때 바로 보입니다.
        </p>
      )}
      {template.status === "failed" && (
        <p className="notice" role="status">
          이 파일에서 글을 읽지 못했습니다. 암호가 걸렸거나 손상된 파일일 수 있습니다. 항목을 직접
          입력하거나, 삭제한 뒤 다른 파일로 다시 등록하세요.
        </p>
      )}
      {template.status === "failed" && !items && (
        <button type="button" className="secondary" disabled={busy} onClick={() => setItems([])}>
          직접 입력
        </button>
      )}
      {template.status === "review" && !items && (
        <section className="panel" aria-labelledby="candidates">
          <h2 id="candidates">꺼낸 후보 {candidates.length}개</h2>
          {template.extraction?.warnings.map((warning) => (
            <p key={warning} className="notice">
              {warning}
            </p>
          ))}
          {candidates.length ? (
            <>
              <p className="help">
                AI로 보내면 안 되는 줄(이름, 연락처, 이미 작성된 값)은 체크를 푸세요. 체크한 줄의
                글만 AI로 보냅니다. 지금 {checked.length}개를 골랐습니다.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setUnchecked([])}
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setUnchecked(candidates.map((c) => c.candidateId))}
                >
                  전체 해제
                </button>
              </div>
              <ul className="template-rows">
                {candidates.map((candidate) => (
                  <li key={candidate.candidateId}>
                    <label className="check">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={!unchecked.includes(candidate.candidateId)}
                        onChange={(event) =>
                          setUnchecked(
                            event.target.checked
                              ? unchecked.filter((value) => value !== candidate.candidateId)
                              : [...unchecked, candidate.candidateId],
                          )
                        }
                      />
                      {candidate.name}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">
              이 양식에서 글이나 표의 칸을 찾지 못했습니다. 빈 문서이거나 그림으로만 된 양식일 수
              있습니다.
            </p>
          )}
          <div className="actions">
            {candidates.length > 0 && (
              <button
                type="button"
                disabled={busy || !checked.length}
                onClick={() => organize(checked)}
              >
                {busy ? "정리 중…" : "AI로 항목 정리"}
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setItems([])}
            >
              직접 입력
            </button>
          </div>
        </section>
      )}
      {items && (
        <section className="panel" aria-labelledby="items">
          <h2 id="items">양식 항목 {items.length}개</h2>
          <p className="help">
            매뉴얼을 만들 때 이 항목을 순서대로 채웁니다. 이름과 작성 안내, 형태를 고치고
            확정하세요. 30개까지 둘 수 있습니다.
          </p>
          <ol className="template-rows">
            {items.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 새 항목은 id가 없어 순서로 구분한다.
              <li key={index}>
                <label htmlFor={`item-name-${index}`}>항목 {index + 1} 이름</label>
                <input
                  id={`item-name-${index}`}
                  disabled={busy}
                  value={item.name}
                  maxLength={80}
                  onChange={(event) => edit(index, { name: event.target.value })}
                />
                <label htmlFor={`item-guide-${index}`}>항목 {index + 1} 작성 안내</label>
                <textarea
                  id={`item-guide-${index}`}
                  disabled={busy}
                  rows={2}
                  value={item.guide}
                  maxLength={500}
                  onChange={(event) => edit(index, { guide: event.target.value })}
                />
                <label htmlFor={`item-kind-${index}`}>항목 {index + 1} 형태</label>
                <select
                  id={`item-kind-${index}`}
                  disabled={busy}
                  value={item.kind}
                  onChange={(event) =>
                    edit(index, { kind: event.target.value === "list" ? "list" : "text" })
                  }
                >
                  <option value="text">글</option>
                  <option value="list">목록(한 줄에 한 항목)</option>
                </select>
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || index === 0}
                    aria-label={`항목 ${index + 1} 위로`}
                    onClick={() => move(index, index - 1)}
                  >
                    위로
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || index === items.length - 1}
                    aria-label={`항목 ${index + 1} 아래로`}
                    onClick={() => move(index, index + 1)}
                  >
                    아래로
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    aria-label={`항목 ${index + 1} 지우기`}
                    onClick={() => setItems(items.filter((_, at) => at !== index))}
                  >
                    지우기
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || items.length >= 30}
              onClick={() => setItems([...items, { name: "", guide: "", kind: "text" }])}
            >
              항목 추가
            </button>
            <button
              type="button"
              disabled={busy || !items.length || items.some((item) => !item.name.trim())}
              onClick={() =>
                patch({ items }, "항목을 확정했습니다. 이제 이 양식을 쓸 수 있습니다.")
              }
            >
              {busy ? "저장 중…" : "항목 확정"}
            </button>
            {template.status !== "ready" && candidates.length > 0 && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setItems(null)}
              >
                후보로 돌아가기
              </button>
            )}
            {template.status === "ready" && !template.isDefault && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => patch({ isDefault: true }, "기본 양식으로 지정했습니다.")}
              >
                기본 양식으로 지정
              </button>
            )}
          </div>
        </section>
      )}
      <hr />
      <h2>양식 삭제</h2>
      <p className="help">
        양식 원본과 꺼낸 후보를 영구 삭제합니다. 이 양식으로 이미 만든 매뉴얼은 그대로 남습니다.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        이 양식의 영구 삭제를 확인했습니다.
      </label>
      <button type="button" className="secondary" disabled={busy || !confirmed} onClick={remove}>
        이 양식 삭제
      </button>
    </>
  );
}
