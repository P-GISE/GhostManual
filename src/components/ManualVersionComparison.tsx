"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { message, publishedSchema, read } from "../lib/client";
import { manualFields } from "./ManualContent";

export function ManualVersionComparison({
  id,
  latest,
}: {
  readonly id: string;
  readonly latest: number;
}) {
  const [versions, setVersions] = useState<z.infer<typeof publishedSchema>[]>([]);
  const [before, setBefore] = useState(latest - 1);
  const [after, setAfter] = useState(latest);
  const [error, setError] = useState("");
  useEffect(() => {
    setBefore(latest - 1);
    setAfter(latest);
    let active = true;
    setError("");
    read(`/api/manuals/${id}/versions`, z.array(publishedSchema))
      .then((value) => {
        if (active) setVersions(value);
      })
      .catch(async (e) => {
        const text = await message(e);
        if (active) setError(text);
      });
    return () => {
      active = false;
    };
  }, [id, latest]);
  const old = versions.find((v) => v.version === before);
  const current = versions.find((v) => v.version === after);
  const fields = [
    { key: "title", label: "제목" },
    ...manualFields,
    { key: "references", label: "원본 인용" },
  ] as const;
  const changed =
    old && current
      ? fields.filter(
          (f) => JSON.stringify(old.content[f.key]) !== JSON.stringify(current.content[f.key]),
        )
      : [];
  const metadataChanges =
    old && current
      ? Number(old.sourceRevisionId !== current.sourceRevisionId) +
        Number(
          JSON.stringify(old.acknowledgedUnknowns) !== JSON.stringify(current.acknowledgedUnknowns),
        ) +
        Number(old.provenance !== current.provenance)
      : 0;
  return (
    <details>
      <summary>게시 버전 변경점 비교</summary>
      <p className="help">
        검수하여 게시한 두 버전의 변경 항목을 비교합니다. 현재 초안은 포함하지 않습니다.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {versions.length === 0 && !error && <p role="status">게시 버전을 불러오고 있습니다.</p>}
      {versions.length === 1 && (
        <p className="muted">비교하려면 게시 버전이 두 개 이상 필요합니다.</p>
      )}
      {versions.length > 1 && (
        <>
          <label htmlFor="version-before">이전 게시 버전</label>
          <select
            id="version-before"
            value={before}
            onChange={(e) => setBefore(Number(e.target.value))}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.version}>
                버전 {v.version}
              </option>
            ))}
          </select>
          <label htmlFor="version-after">이후 게시 버전</label>
          <select
            id="version-after"
            value={after}
            onChange={(e) => setAfter(Number(e.target.value))}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.version}>
                버전 {v.version}
              </option>
            ))}
          </select>
          {before >= after ? (
            <p className="notice" role="status">
              이전 버전보다 큰 이후 버전을 선택하세요.
            </p>
          ) : (
            old &&
            current && (
              <>
                <p className="help" role="status">
                  버전 {before} → 버전 {after} · 내용 변경 {changed.length}개 · 검수·근거 기록 변경{" "}
                  {metadataChanges}개
                </p>
                {old.sourceRevisionId !== current.sourceRevisionId && (
                  <p className="notice">근거 원본의 revision이 변경되었습니다.</p>
                )}
                {JSON.stringify(old.acknowledgedUnknowns) !==
                  JSON.stringify(current.acknowledgedUnknowns) && (
                  <section className="notice">
                    <h3>미확인 항목 검수 기록 변경</h3>
                    <p>이전: {old.acknowledgedUnknowns.join(" · ") || "없음"}</p>
                    <p>이후: {current.acknowledgedUnknowns.join(" · ") || "없음"}</p>
                  </section>
                )}
                {old.provenance !== current.provenance && (
                  <p className="notice">
                    작성 출처: {provenanceLabel(old.provenance)} →{" "}
                    {provenanceLabel(current.provenance)}
                  </p>
                )}
                {changed.length === 0 && (
                  <p className="muted">매뉴얼 내용과 원본 인용이 같습니다.</p>
                )}
                {changed.map((f) => (
                  <section className="document" key={f.key}>
                    <h3>{f.label}</h3>
                    <h4>이전 · 버전 {before}</h4>
                    <p className="source-text">{display(old.content[f.key])}</p>
                    <h4>이후 · 버전 {after}</h4>
                    <p className="source-text">{display(current.content[f.key])}</p>
                  </section>
                ))}
              </>
            )
          )}
        </>
      )}
    </details>
  );
}
function display(
  value: z.infer<typeof publishedSchema>["content"][keyof z.infer<
    typeof publishedSchema
  >["content"]],
) {
  if (Array.isArray(value))
    return value.length
      ? value
          .map((item) =>
            typeof item === "string"
              ? item
              : `${item.field} · 문단 ${item.paragraphId}: ${item.quote}`,
          )
          .join(String.fromCharCode(10))
      : "확인된 내용 없음";
  return value ?? "확인된 내용 없음";
}

function provenanceLabel(value: string) {
  return value === "ai" ? "AI 생성" : value === "example" ? "합성 예제" : "담당자 작성";
}
