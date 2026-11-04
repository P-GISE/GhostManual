"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";
import { SourceInputSchema } from "../lib/schemas";
import { useUnsavedChanges } from "./useUnsavedChanges";

const similarSchema = z.array(
  z.object({
    id: z.uuid(),
    title: z.string(),
    revision: z.number(),
    fileName: z.string(),
    sameAsLatest: z.boolean(),
  }),
);
type Similar = z.infer<typeof similarSchema>;
async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function SourceForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [similar, setSimilar] = useState<Similar | null>(null);
  const lookup = useRef(0);
  function invalidateLookup() {
    lookup.current++;
    setSimilar(null);
  }
  useUnsavedChanges(!submitted && !!(title || text || file));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await register(false);
  }
  // Asks first when an .xlsx looks like the next version of a workbook already in the library.
  async function register(asNewSource: boolean) {
    if (busy) return;
    const request = ++lookup.current;
    setError("");
    if (!file && !SourceInputSchema.safeParse({ title, text }).success) {
      setError("제목은 1~120자, 본문은 100~20,000자로 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      if (file && /\.xlsx$/i.test(file.name) && !asNewSource) {
        const digest = await sha256(file);
        if (request !== lookup.current) {
          setBusy(false);
          return;
        }
        const params = new URLSearchParams({
          fileName: file.name,
          title,
          sha256: digest,
        });
        const found = await read(`/api/sources/similar?${params}`, similarSchema);
        if (request !== lookup.current) {
          setBusy(false);
          return;
        }
        if (found.length) {
          setSimilar(found);
          setBusy(false);
          return;
        }
      }
      let result: unknown;
      if (file) {
        const body = new FormData();
        body.set("title", title);
        body.set("file", file);
        result = await http.post("/api/sources", { body }).json();
      } else result = await http.post("/api/sources", { json: { title, text } }).json();
      const source = z.object({ id: z.uuid() }).parse(result);
      setSubmitted(true);
      router.push(`/sources/${source.id}`);
    } catch (e) {
      if (request === lookup.current) setError(await message(e));
      setBusy(false);
    }
  }
  async function addVersion(target: Similar[number]) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("expectedRevision", String(target.revision));
      await http.post(`/api/sources/${target.id}/revisions`, { body, timeout: 60000 }).json();
      setSubmitted(true);
      router.push(`/sources/${target.id}`);
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  return (
    <section className="prose">
      <span className="eyebrow">원본 자료</span>
      <h1>새 업무 등록</h1>
      <p className="muted">업무 경험을 자유롭게 적어 주세요. 원본은 매뉴얼의 근거로 보존됩니다.</p>
      <p className="notice">
        <strong>처음 올리는 파일만 여기서 등록하세요.</strong> 이미 등록한 엑셀의 다음 파일이면
        문서함에서 그 업무 카드의 <strong>새 버전 올리기</strong>를 누르세요. 여기서 다시 올리면
        이전 버전과 비교되지 않는 별개의 업무가 됩니다.
      </p>
      <div className="notice">
        자료는 내 문서함에 계정을 삭제할 때까지 보관됩니다. AI 기능이 활성화되면 필요한 원문이 외부
        AI 제공자에게 전송될 수 있습니다.
      </div>
      <form onSubmit={submit}>
        <label htmlFor="title">자료 제목</label>
        <input
          id="title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => {
            invalidateLookup();
            setTitle(e.target.value);
          }}
          placeholder="예: 월말 정산 업무 인수인계"
        />
        <label htmlFor="source-file">
          엑셀·TXT·Markdown 파일 <span className="help">선택 사항</span>
        </label>
        <input
          id="source-file"
          type="file"
          accept=".xlsx,.txt,.md,.markdown"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            invalidateLookup();
          }}
          aria-describedby="file-help"
        />
        <p id="file-help" className="help">
          엑셀(.xlsx, 최대 5 MB)은 원본 파일을 버전으로 보관하고 새 버전을 올릴 때마다 바뀐 부분을
          비교해 질문합니다. 매크로·암호 파일은 올릴 수 없습니다. TXT·Markdown(UTF-8, 최대 256
          KiB)은 파일 내용을 텍스트로 등록합니다.
        </p>
        {file ? (
          <p className="notice" role="status">
            파일을 올리면 업무 내용은 따로 쓰지 않습니다.{" "}
            {/\.xlsx$/i.test(file.name)
              ? "엑셀은 등록한 뒤 원본 화면의 질문에 답하며 설명을 남깁니다."
              : "파일 안의 글이 업무 내용으로 등록됩니다."}
            {text && " 입력한 업무 내용은 저장되지 않습니다. 쓰려면 파일 선택을 지우세요."}
          </p>
        ) : (
          <>
            <label htmlFor="text">업무 내용</label>
            <textarea
              id="text"
              rows={14}
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
          </>
        )}
        {similar && file && (
          <fieldset className="panel" aria-label="기존 자료의 새 버전인가요?">
            <h2>기존 자료의 새 버전인가요?</h2>
            <p>
              <strong>{file.name}</strong>은 이미 올린 엑셀과 이름이나 내용이 비슷합니다. 같은
              파일의 다음 버전이라면 새 버전으로 올려야 이전 버전과 비교해 바뀐 부분을 묻습니다.
            </p>
            {similar.map((s) => (
              <div key={s.id} className="actions">
                <button type="button" disabled={busy} onClick={() => addVersion(s)}>
                  「{s.title}」의 새 버전으로 올리기
                </button>
                <span className="help">
                  {s.fileName} · 현재 v{s.revision}
                  {s.sameAsLatest ? " · 최신 버전과 내용이 같습니다" : ""}
                </span>
              </div>
            ))}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => register(true)}
              >
                새 자료로 등록
              </button>
            </div>
          </fieldset>
        )}
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
