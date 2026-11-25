"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { message, read } from "../lib/client";
import { progressStep, progressSteps } from "../lib/task-state";

const progressSchema = z.object({
  works: z
    .array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        manualTitle: z.string().nullable(),
        createdByName: z.string().nullable(),
        revision: z.number(),
        revisionAt: z.string(),
        openQuestions: z.number(),
        manualId: z.uuid().nullable(),
        publishedVersion: z.number().nullable(),
        needsReview: z.boolean(),
        unpublishedChanges: z.boolean(),
      }),
    )
    .max(10),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
type Progress = z.infer<typeof progressSchema>;

// 팀 화면의 "진행 현황" 탭. 관리자와 부관리자에게만 보인다(서버도 같은 검사를 한다).
export function TeamProgress({ id }: { readonly id: string }) {
  const [result, setResult] = useState<{ id: string; data: Progress } | null>(null);
  const [page, setPage] = useState<{ id: string; cursor: string | null }>({ id, cursor: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef(false);
  const previousId = useRef(id);
  const progress = result?.id === id ? result.data : null;
  const cursor = page.id === id ? page.cursor : null;
  useEffect(() => {
    let active = true;
    if (previousId.current !== id) {
      previousId.current = id;
      focusAfter.current = false;
    }
    locked.current = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (page.id === id && page.cursor) params.set("afterWork", page.cursor);
    void read(`/api/workspaces/${id}/progress${params.size ? `?${params}` : ""}`, progressSchema)
      .then((data) => {
        if (active) setResult({ id, data });
      })
      .catch(async (e) => {
        const detail = await message(e);
        if (active) setError(detail);
      })
      .finally(() => {
        if (active) {
          locked.current = false;
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id, page]);
  useEffect(() => {
    if (!loading && focusAfter.current) {
      focusAfter.current = false;
      heading.current?.focus();
    }
  }, [loading]);
  const load = (next: string | null) => {
    if (locked.current) return;
    locked.current = true;
    focusAfter.current = true;
    setLoading(true);
    setPage({ id, cursor: next });
  };
  return (
    <section className="panel" aria-labelledby="progress">
      <h2 id="progress" ref={heading} tabIndex={-1}>
        진행 현황
      </h2>
      <p className="help">
        업무마다 누가 올렸고 어디까지 왔는지 봅니다. 관리자와 부관리자에게만 보이는 탭입니다.
      </p>
      {loading && (
        <p className="loading" role="status">
          진행 현황을 불러오고 있습니다.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {error && (
        <button type="button" className="secondary" disabled={loading} onClick={() => load(cursor)}>
          다시 불러오기
        </button>
      )}
      {progress && (
        <p className="help">
          전체 {progress.total}개 · 현재 {progress.works.length}개 표시
        </p>
      )}
      {progress &&
        (progress.works.length ? (
          <div className="table-scroll">
            <table className="progress-table">
              <thead>
                <tr>
                  <th scope="col">업무</th>
                  <th scope="col">올린 사람</th>
                  <th scope="col">진행 단계</th>
                  <th scope="col">마지막 버전</th>
                </tr>
              </thead>
              <tbody>
                {progress.works.map((work) => {
                  const current = progressStep(work);
                  return (
                    <tr key={work.id}>
                      <th scope="row">{work.manualTitle ?? work.title}</th>
                      <td>{work.createdByName ?? "-"}</td>
                      <td>
                        <ol className="progress-steps">
                          {progressSteps.map((step, index) => (
                            <li
                              key={step}
                              className={
                                index < current ? "done" : index === current ? "current" : undefined
                              }
                            >
                              {step}
                              {index === 1 && index === current && ` ${work.openQuestions}개 남음`}
                              {index === 4 && index < current && ` v${work.publishedVersion}`}
                              <span className="visually-hidden">
                                {index < current ? " 끝남" : index === current ? " 진행 중" : " 전"}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </td>
                      <td>
                        {new Date(work.revisionAt).toLocaleDateString("ko-KR", {
                          month: "long",
                          day: "numeric",
                        })}{" "}
                        · 버전 {work.revision}개
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">아직 올린 업무가 없습니다.</p>
        ))}
      {progress && (progress.total > 10 || cursor) && (
        <nav className="actions" aria-label="진행 현황 페이지">
          <button
            type="button"
            className="secondary"
            disabled={loading || !cursor}
            onClick={() => load(null)}
          >
            처음 업무
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loading || !progress.nextCursor}
            onClick={() => load(progress.nextCursor)}
          >
            다음 업무
          </button>
        </nav>
      )}
    </section>
  );
}
