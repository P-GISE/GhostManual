export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("Expected finite nonnegative samples");
  if (!(fraction > 0 && fraction <= 1)) throw new Error("Expected percentile in (0, 1]");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

export function assertLatencyTarget(env: Readonly<Record<string, string | undefined>>): void {
  const url = new URL(env["DATABASE_URL"] ?? "https://invalid");
  if (
    env["GITHUB_ACTIONS"] !== "true" ||
    env["AI_ENABLED"] !== "false" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/ghostmanual_latency_test" ||
    env["APP_ORIGIN"] !== "http://localhost:3200"
  )
    throw new Error("Latency probe requires GitHub Actions and the dedicated local test database");
}

export function apiCategory(url: string): string {
  return new URL(url).pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/revisions\/\d+/g, "/revisions/:revision");
}
