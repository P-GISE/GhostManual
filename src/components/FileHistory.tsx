import { type FileHistory as History, kst } from "../lib/client";
import { changeLabels, who } from "./FileVersions";

export function FileHistory({
  history,
  sourceId,
  reader,
}: {
  readonly history: History;
  readonly sourceId: string;
  readonly reader: boolean;
}) {
  const latest = history.revisions.at(-1)?.revision;
  return (
    <section className="panel" aria-labelledby="file-history-title">
      <h2 id="file-history-title">파일 변경 이력</h2>
      <p className="help">게시 당시 기록 · 질문의 답은 작성자 설명입니다.</p>
      {[...history.revisions].reverse().map((r) => (
        <article key={r.revision} className="history-entry">
          <h3>
            v{r.revision} · {kst(r.createdAt)} · {who(r)}
          </h3>
          {r.aiSummary && (
            <p>
              <span className="badge">AI 요약</span> {r.aiSummary}
            </p>
          )}
          {r.changes.length > 0 && (
            <p className="muted">
              바뀐 부분:{" "}
              {r.changes
                .map((c) =>
                  `${changeLabels[c.kind] ?? c.kind} ${c.sheet ? `'${c.sheet}'` : ""} ${c.range ?? ""}`.trim(),
                )
                .join(" · ")}
            </p>
          )}
          <dl>
            {r.questions.map((q) => (
              <div key={q.question}>
                <dt>Q. {q.question}</dt>
                <dd>
                  {q.answer !== null
                    ? `A. ${q.answer}`
                    : "답변 없음 · 게시 전에 확인 필요로 확인됨"}
                </dd>
              </div>
            ))}
          </dl>
          {r.revision === latest ? (
            <a
              className="button secondary"
              href={`/api/sources/${sourceId}/revisions/${r.revision}/file${reader ? "?view=shared" : ""}`}
            >
              {r.fileName} 내려받기
            </a>
          ) : (
            reader && <p className="help">이전 버전 원본은 작성자만 내려받을 수 있습니다.</p>
          )}
        </article>
      ))}
    </section>
  );
}
