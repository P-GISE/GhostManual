import { expect, it } from "vitest";
import { normalizeSearch, searchTerms, selectContext } from "../../src/lib/retrieval.ts";

it("normalizes Korean spacing, compatibility characters and small synonyms", () => {
  expect(normalizeSearch("Ａ 정산 파일")).toBe("a정산파일");
  expect(searchTerms("승인자는 누구인가요?")).toContain("결재");
});
it("caps context at six and 12000 characters", () => {
  expect(selectContext([])).toEqual([]);
});
