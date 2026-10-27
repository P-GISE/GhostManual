import { HTTPError, NetworkError, TimeoutError } from "ky";
import { ZodError } from "zod";

export type RequestStage = "create" | "session" | "manuals" | "sources";
export type RequestDiagnostic = {
  stage: RequestStage;
  status: number | null;
  category: "success" | "http" | "timeout" | "network" | "response" | "unknown";
  retryable: boolean;
};

// Only fixed classifications leave this boundary; never exception messages or response bodies.
export function requestDiagnostic(
  stage: RequestStage,
  error?: unknown,
  successStatus?: number,
): RequestDiagnostic {
  if (error instanceof HTTPError) {
    const status = error.response.status;
    return {
      stage,
      status,
      category: "http",
      retryable: status === 408 || status === 429 || status >= 500,
    };
  }
  if (error instanceof TimeoutError)
    return { stage, status: null, category: "timeout", retryable: true };
  if (error instanceof ZodError || error instanceof SyntaxError)
    return { stage, status: successStatus ?? null, category: "response", retryable: false };
  if (error instanceof NetworkError || error instanceof TypeError)
    return { stage, status: null, category: "network", retryable: true };
  return {
    stage,
    status: error === undefined ? (successStatus ?? null) : null,
    category: error === undefined ? "success" : "unknown",
    retryable: false,
  };
}
