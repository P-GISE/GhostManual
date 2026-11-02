import { expect, it } from "vitest";
import { cost, summarize } from "../../scripts/ai-usage.ts";

const line = (
  kind: string,
  inputTokens: number,
  outputTokens: number,
  model = "claude-sonnet-5-5",
) => ({
  kind,
  model,
  inputTokens,
  outputTokens,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  ms: 1000,
});

it("prices Sonnet 5.5 at $2 input and $10 output per million tokens", () => {
  expect(cost(line("x", 1_000_000, 0))).toBe(2);
  expect(cost(line("x", 0, 1_000_000))).toBe(10);
  expect(cost(line("x", 1, 1, "unknown-model"))).toBeNull();
});
it("groups calls by kind with averages and totals", () => {
  const [change, manual] = summarize([
    line("change_questions", 2000, 1000),
    line("change_questions", 4000, 1000),
    line("manual_draft", 10000, 5000),
  ]);
  expect(change).toMatchObject({
    kind: "change_questions",
    calls: 2,
    avgInput: 3000,
    avgOutput: 1000,
  });
  expect(change?.usdTotal).toBeCloseTo(0.032);
  expect(manual?.usdPerCall).toBeCloseTo(0.07);
});
it("marks cost unknown when a fallback model has no price", () => {
  const [row] = summarize([line("change_questions", 10, 10, "claude-other")]);
  expect(row?.usdTotal).toBeNull();
});
