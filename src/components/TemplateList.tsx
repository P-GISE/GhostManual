"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";

export const templateStatusText = {
  reading: "읽는 중",
  review: "항목 확인 필요",
  ready: "사용 가능",
  failed: "읽지 못함",
} as const;
const statusSchema = z.enum(["reading", "review", "ready", "failed"]);
const listSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    status: statusSchema,
    itemCount: z.number(),
    isDefault: z.boolean(),
  }),
);
// 팀 화면의 "양식" 탭.
export function TemplateList({ allowUpload = true }: { readonly allowUpload?: boolean } = {}) {
  const router = useRouter();
  const [templates, setTemplates] = useState<z.infer<typeof listSchema> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    read("/api/templates", listSchema)
      .then(setTemplates)
      .catch(async (e) => setError(await message(e)));
  }, []);
  async function upload() {
    if (!allowUpload || !file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const created = z
        .object({ id: z.uuid() })
        .parse(await http.post("/api/templates", { body, timeout: 60000 }).json());
      router.push(`/templates/${created.id}`);
    } catch (e) {
      setError(await message(e));
      setBusy(false);
    }
  }
  return (
    <>
      <h2>양식</h2>
      <p className="muted">
        회사에서 쓰는 인수인계 양식을 등록하면 그 양식의 항목에 맞춰 매뉴얼을 만들 수 있습니다.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {allowUpload && (
        <section className="panel">
          <h2>양식 등록</h2>
          <label htmlFor="template-file">양식 파일</label>
          <input
            id="template-file"
            type="file"
            accept=".docx,.hwpx"
            aria-describedby="template-file-help"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p id="template-file-help" className="help">
            내용이 채워진 문서가 아니라 빈 양식을 올리세요. DOCX·HWPX, 최대 5 MB, 20개까지 보관할 수
            있습니다.
          </p>
          <div className="actions">
            <button type="button" disabled={!file || busy} onClick={upload}>
              {busy ? "등록 중…" : "양식 등록"}
            </button>
          </div>
        </section>
      )}
      <h2>등록한 양식</h2>
      {!templates ? (
        !error && (
          <p className="loading" role="status">
            양식을 불러오고 있습니다.
          </p>
        )
      ) : templates.length ? (
        <ul>
          {templates.map((template) => (
            <li key={template.id}>
              <Link href={`/templates/${template.id}`}>{template.name}</Link>{" "}
              <span className="badge">{templateStatusText[template.status]}</span>
              {template.isDefault && <span className="badge">기본 양식</span>}
              {template.status === "ready" && (
                <span className="help">항목 {template.itemCount}개</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">등록한 양식이 없습니다.</p>
      )}
    </>
  );
}
