"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";
import { templateStatusText } from "./TemplateList";

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
});
type Template = z.infer<typeof templateSchema>;
export function TemplateDetail({ id }: { readonly id: string }) {
  const router = useRouter();
  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reading = !template || template.status === "reading";
  useEffect(() => {
    if (!reading) return;
    let stopped = false;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      read(`/api/templates/${id}`, templateSchema)
        .then((current) => {
          if (!stopped) setTemplate(current);
        })
        .catch(async (e) => {
          const text = await message(e);
          if (!stopped) setError(text);
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
  return (
    <>
      <Link href="/templates">양식 목록</Link>
      <h1>{template.name}</h1>
      <p>
        <span className="badge">{templateStatusText[template.status]}</span>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {template.status === "reading" && (
        <p className="loading" role="status">
          양식에서 항목 후보를 꺼내고 있습니다. 이 화면을 열어 두면 끝났을 때 바로 보입니다.
        </p>
      )}
      {template.status === "failed" && (
        <p className="notice" role="status">
          이 파일에서 글을 읽지 못했습니다. 암호가 걸렸거나 손상된 파일일 수 있습니다. 삭제한 뒤
          다른 파일로 다시 등록하세요.
        </p>
      )}
      {template.status === "review" && (
        <section className="panel" aria-labelledby="candidates">
          <h2 id="candidates">꺼낸 후보 {candidates.length}개</h2>
          {template.extraction?.warnings.map((warning) => (
            <p key={warning} className="notice">
              {warning}
            </p>
          ))}
          {candidates.length ? (
            <ol>
              {candidates.map((candidate) => (
                <li key={candidate.candidateId}>{candidate.name}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              이 양식에서 글이나 표의 칸을 찾지 못했습니다. 빈 문서이거나 그림으로만 된 양식일 수
              있습니다.
            </p>
          )}
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
