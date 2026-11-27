"use client";
import { useEffect, useState } from "react";
import { type FileRevision, http, message } from "../lib/client";
import { documentPending, documentStatusSchema, waitForDocument } from "../lib/document-progress";

export function DocumentProgress({
  sourceId,
  revision,
  revisionId,
  selectionVersion,
  readDetail,
  onComplete,
}: {
  readonly sourceId: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly selectionVersion: number;
  readonly readDetail: (revision: number, signal?: AbortSignal) => Promise<FileRevision>;
  readonly onComplete: (detail: FileRevision, selectionVersion: number) => void;
}) {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly restarts the read-only watcher after retry.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void waitForDocument(async (signal) => {
      const status = documentStatusSchema.parse(
        await http
          .get(`/api/sources/${sourceId}/revisions/${revision}/status`, {
            signal,
            timeout: 15000,
          })
          .json(),
      );
      if (status.revisionId !== revisionId) throw new Error("문서 버전이 변경됐습니다.");
      return status;
    }, controller.signal)
      .then(async () => {
        if (!active) return;
        const detail = await readDetail(revision, controller.signal);
        if (!active) return;
        if (
          !detail.extraction ||
          detail.revisionId !== revisionId ||
          documentPending(detail.extraction?.status ?? "")
        ) {
          throw new Error("문서 상태가 변경됐습니다. 다시 확인하세요.");
        }
        onComplete(detail, selectionVersion);
      })
      .catch(async (reason) => {
        const detail = await message(reason);
        if (active) setError(detail);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [sourceId, revision, revisionId, selectionVersion, readDetail, onComplete, attempt]);
  if (!error) return null;
  return (
    <div>
      <p className="error" role="alert">
        {error}
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setError("");
          setAttempt((value) => value + 1);
        }}
      >
        처리 상태 다시 확인
      </button>
    </div>
  );
}
