import { readFileSync } from "node:fs";

// USD per million tokens, Anthropic list prices verified 2026-11-02 (platform.claude.com/docs/en/about-claude/pricing). Cache writes are 1.25x input.
const prices: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
type Line = {
  kind: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  ms: number;
};
export type Row = {
  kind: string;
  calls: number;
  avgInput: number;
  avgOutput: number;
  avgMs: number;
  usdPerCall: number | null;
  usdTotal: number | null;
};

export function cost(line: Line): number | null {
  const price = prices[line.model];
  if (!price) return null;
  const longHaiku =
    line.model === "claude-haiku-5-5" &&
    line.inputTokens + line.cacheWriteTokens + line.cacheReadTokens > 100_000;
  return (
    (longHaiku ? 5 : 1) *
    (line.inputTokens * price.input +
      line.cacheWriteTokens * price.input * 1.25 +
      line.cacheReadTokens * price.cacheRead +
      line.outputTokens * price.output) /
    1_000_000
  );
}
export function summarize(lines: readonly Line[]): Row[] {
  const kinds = [...new Set(lines.map((l) => l.kind))].sort();
  return kinds.map((kind) => {
    const rows = lines.filter((l) => l.kind === kind);
    const costs = rows.map(cost);
    const known = costs.every((c) => c !== null);
    const total = costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);
    const avg = (pick: (l: Line) => number) =>
      Math.round(rows.reduce((sum, l) => sum + pick(l), 0) / rows.length);
    return {
      kind,
      calls: rows.length,
      avgInput: avg((l) => l.inputTokens + l.cacheWriteTokens + l.cacheReadTokens),
      avgOutput: avg((l) => l.outputTokens),
      avgMs: avg((l) => l.ms),
      usdPerCall: known ? total / rows.length : null,
      usdTotal: known ? total : null,
    };
  });
}

if (import.meta.main) {
  const file = process.argv[2] ?? process.env["AI_USAGE_LOG"];
  if (!file) throw new Error("Usage: node scripts/ai-usage.ts <usage.jsonl>");
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);
  console.table(
    summarize(lines).map((r) => ({
      ...r,
      usdPerCall: r.usdPerCall?.toFixed(4) ?? "unknown model",
      usdTotal: r.usdTotal?.toFixed(4) ?? "unknown model",
    })),
  );
  const models = [...new Set(lines.map((l) => l.model))];
  console.log(`calls ${lines.length}, models ${models.join(", ")}`);
}
