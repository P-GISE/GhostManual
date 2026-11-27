import type { Page, Request, Response } from "@playwright/test";
import { apiCategory } from "./latency-metrics.ts";

export type Row = {
  phase: string;
  format: string;
  sample: number;
  warmup: boolean;
  elapsedMs: number;
  startedRequests: number;
  unobservedResponses: number;
  api: { category: string; status: number; elapsedMs: number; decodedBytes: number }[];
};
export const rows: Row[] = [];
export async function measure(
  page: Page,
  phase: string,
  format: string,
  sample: number,
  action: () => Promise<void>,
) {
  const starts = new Map<Request, number>();
  const pending: Promise<void>[] = [];
  const observed = new Set<Request>();
  const api: Row["api"] = [];
  const started = performance.now();
  const onRequest = (request: Request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) starts.set(request, performance.now());
  };
  const onResponse = (response: Response) => {
    const at = starts.get(response.request());
    if (at === undefined) return;
    observed.add(response.request());
    pending.push(
      (async () => {
        try {
          const body = await response.body();
          api.push({
            category: apiCategory(response.url()),
            status: response.status(),
            elapsedMs: performance.now() - at,
            decodedBytes: body.byteLength,
          });
        } catch {
          api.push({
            category: apiCategory(response.url()),
            status: 0,
            elapsedMs: performance.now() - at,
            decodedBytes: 0,
          });
        }
      })(),
    );
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    await action();
    const elapsedMs = performance.now() - started;
    page.off("request", onRequest);
    page.off("response", onResponse);
    await Promise.all(pending);
    rows.push({
      phase,
      format,
      sample,
      warmup: sample === 0,
      elapsedMs,
      startedRequests: starts.size,
      unobservedResponses: starts.size - observed.size,
      api,
    });
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}
export function add(phase: string, format: string, sample: number, elapsedMs: number) {
  rows.push({
    phase,
    format,
    sample,
    warmup: sample === 0,
    elapsedMs,
    startedRequests: 0,
    unobservedResponses: 0,
    api: [],
  });
}
