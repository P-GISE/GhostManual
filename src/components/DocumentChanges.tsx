"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, message } from "../lib/client";

const changeSchema = z.object({
  kind: z.string(),
  path: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
const detailSchema = z.object({
  snapshot: z
    .object({
      extractionMode: z.enum(["native", "ocr"]),
      blocks: z.array(z.object({ path: z.string(), text: z.string() })),
      warnings: z.array(z.string()),
    })
    .nullable(),
  comparison: z
    .object({
      status: z.enum(["compared", "no_changes", "limit_exceeded"]),
      changes: z.array(changeSchema),
    })
    .nullable(),
  ocrReview: z
    .object({ status: z.literal("review_required"), changes: z.array(changeSchema) })
    .nullable()
    .default(null),
});
export function DocumentChanges({
  sourceId,
  revision,
}: {
  readonly sourceId: string;
  readonly revision: number;
}) {
  const [detail, setDetail] = useState<z.infer<typeof detailSchema> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt restarts a failed request.
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError("");
    void http
      .get(`/api/sources/${sourceId}/revisions/${revision}/document`, {
        signal: controller.signal,
        timeout: 15000,
      })
      .json()
      .then((body) => {
        if (!controller.signal.aborted) setDetail(detailSchema.parse(body));
      })
      .catch(async (e) => {
        if (!controller.signal.aborted) setError(await message(e));
      });
    return () => controller.abort();
  }, [sourceId, revision, attempt]);
  if (error)
    return (
      <section className="panel">
        <p className="error" role="alert">
          {error}
        </p>
        <button type="button" onClick={() => setAttempt((current) => current + 1)}>
          문서 비교 다시 불러오기
        </button>
      </section>
    );
  if (!detail) return <p role="status">문서 내용을 불러오고 있습니다.</p>;
  const comparison =
    detail.ocrReview ?? (detail.comparison?.status !== "limit_exceeded" ? detail.comparison : null);
  return (
    <section className="panel" aria-labelledby="document-preview-title">
      <h2 id="document-preview-title">추출 내용·문서 변경 보기</h2>
      <p className="help">
        이전·현재 내용은 소유자만 확인할 수 있습니다. 글꼴·배치·이미지 변경은 비교하지 않습니다.
      </p>
      {detail.snapshot?.extractionMode === "ocr" && (
        <p className="notice">
          스캔 문서를 글자로 인식한 결과입니다. 잘못 읽힌 부분이 없는지 원본과 대조하세요.
        </p>
      )}
      {!!detail.snapshot?.warnings.length && (
        <p className="notice">
          일부 내용을 완전히 읽지 못했을 수 있습니다. 원본과 비교 범위를 확인하세요.
        </p>
      )}
      {detail.ocrReview && (
        <p className="notice">
          OCR 인식 결과의 검토용 비교입니다. 인식 오류가 있을 수 있으며, 차이가 0건이어도 원본이
          같다는 뜻은 아닙니다. 원본을 직접 대조하세요.
        </p>
      )}
      {comparison && (
        <details>
          <summary>
            {detail.ocrReview ? "OCR 인식 결과 차이" : "내용 변경"} {comparison.changes.length}건
          </summary>
          {comparison.changes.slice(0, 100).map((change) => (
            <section key={`${change.kind}:${change.path}`}>
              <h3>
                {change.kind === "block_added"
                  ? "내용 추가"
                  : change.kind === "block_removed"
                    ? "내용 삭제"
                    : "내용 수정"}{" "}
                · {change.path}
              </h3>
              {change.before !== null && (
                <>
                  <span className="help">이전 내용</span>
                  <p className="document-text">{change.before}</p>
                </>
              )}
              {change.after !== null && (
                <>
                  <span className="help">현재 내용</span>
                  <p className="document-text">{change.after}</p>
                </>
              )}
            </section>
          ))}
          {comparison.changes.length > 100 && (
            <p className="help">앞쪽 100건만 표시합니다. 전체 내용은 원본 파일을 확인하세요.</p>
          )}
        </details>
      )}
      {detail.snapshot && (
        <details>
          <summary>현재 추출 내용 {detail.snapshot.blocks.length}개</summary>
          {detail.snapshot.blocks.slice(0, 100).map((block) => (
            <section key={block.path}>
              <span className="help">{block.path}</span>
              <p className="document-text">{block.text}</p>
            </section>
          ))}
          {detail.snapshot.blocks.length > 100 && (
            <p className="help">앞쪽 100개만 표시합니다. 전체 내용은 원본 파일을 확인하세요.</p>
          )}
        </details>
      )}
    </section>
  );
}
