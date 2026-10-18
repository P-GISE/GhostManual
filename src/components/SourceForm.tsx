"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { http, message, sourceSchema } from "../lib/client";
import { SourceInputSchema } from "../lib/schemas";
import { useUnsavedChanges } from "./useUnsavedChanges";
export function SourceForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useUnsavedChanges(!submitted && !!(title || text || file));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!file && !SourceInputSchema.safeParse({ title, text }).success) {
      setError("제목은 1~120자, 본문은 100~20,000자로 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      let result: unknown;
      if (file) {
        const body = new FormData();
        body.set("title", title);
        body.set("file", file);
        result = await http.post("/api/sources", { body }).json();
      } else result = await http.post("/api/sources", { json: { title, text } }).json();
      const source = sourceSchema.parse(result);
      setSubmitted(true);
      router.push(`/sources/${source.id}`);
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  return (
    <section className="prose">
      <span className="eyebrow">원본 자료</span>
      <h1>업무 자료 등록</h1>
      <p className="muted">업무 경험을 자유롭게 적어 주세요. 원본은 매뉴얼의 근거로 보존됩니다.</p>
      <div className="notice">
        임시 작업 공간의 자료는 만료 후 접근할 수 없습니다. AI 기능이 활성화되면 필요한 원문이 외부
        AI 제공자에게 전송될 수 있습니다.
      </div>
      <form onSubmit={submit}>
        <label htmlFor="title">자료 제목</label>
        <input
          id="title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 월말 정산 업무 인수인계"
        />
        <label htmlFor="source-file">
          TXT / Markdown 파일 <span className="help">선택 사항</span>
        </label>
        <input
          id="source-file"
          type="file"
          accept=".txt,.md,.markdown"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-describedby="file-help"
        />
        <p id="file-help" className="help">
          UTF-8, 최대 256 KiB. 파일을 선택하면 아래 본문 대신 파일 내용을 등록합니다. 원본 파일 대신
          해독된 텍스트를 저장합니다.
        </p>
        <label htmlFor="text">업무 내용</label>
        <textarea
          id="text"
          rows={14}
          disabled={!!file}
          minLength={100}
          maxLength={20000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="source-help source-error"
          placeholder="언제 시작하나요? 누가 담당하나요? 어떤 순서로 진행하나요? 주의할 점과 완료 기준을 적어 주세요."
        />
        <p id="source-help" className="help">
          100~20,000자 · 현재 {text.length.toLocaleString()}자. 개인정보와 회사 기밀을 제외해
          주세요.
        </p>
        {error && (
          <p id="source-error" className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "등록하고 있습니다…" : "원본 등록"}
          </button>
        </div>
      </form>
    </section>
  );
}
