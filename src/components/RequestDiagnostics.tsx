"use client";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { RequestDiagnostic } from "../lib/request-diagnostic";

const DiagnosticContext = createContext<{
  entries: RequestDiagnostic[];
  record: (entry: RequestDiagnostic) => void;
  reset: () => void;
} | null>(null);

export function DiagnosticProvider({ children }: { readonly children: ReactNode }) {
  const [entries, setEntries] = useState<RequestDiagnostic[]>([]);
  const record = useCallback((entry: RequestDiagnostic) => {
    setEntries((previous) => [...previous.filter((item) => item.stage !== entry.stage), entry]);
  }, []);
  const reset = useCallback(() => setEntries([]), []);
  const value = useMemo(() => ({ entries, record, reset }), [entries, record, reset]);
  return <DiagnosticContext.Provider value={value}>{children}</DiagnosticContext.Provider>;
}

export function useRequestDiagnostics() {
  const value = useContext(DiagnosticContext);
  if (!value) throw new Error("DiagnosticProvider required");
  return value;
}

export function RequestDiagnostics() {
  const { entries } = useRequestDiagnostics();
  return (
    <details>
      <summary>오류 진단</summary>
      <p className="help">
        문의할 때 아래 단계와 상태를 함께 알려 주세요. 문서 내용이나 로그인 정보는 포함하지
        않습니다.
      </p>
      <ul data-testid="request-diagnostics">
        {entries.map((entry) => (
          <li key={entry.stage}>
            {entry.stage} / {entry.status ?? "no-response"} / {entry.category} /{" "}
            {entry.retryable ? "retry" : "check"}
          </li>
        ))}
      </ul>
    </details>
  );
}
