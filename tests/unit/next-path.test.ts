import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../src/lib/next-path.ts";

describe("same-site next paths", () => {
  it.each([
    "//attacker.invalid",
    "/\\attacker.invalid",
    "/\t/attacker.invalid",
    "/\n\\attacker.invalid",
    "/\r/attacker.invalid",
    "\\/attacker.invalid",
    "https://attacker.invalid",
    "",
    null,
    {},
  ])("falls back for unsafe input %j", (value) => {
    expect(safeNextPath(value)).toBe("/manuals");
  });

  it("rejects every raw ASCII control anywhere in the path", () => {
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      const control = String.fromCharCode(code);
      for (const value of [
        `${control}/manuals`,
        `/manuals${control}`,
        `/manuals?q=${control}#part`,
      ]) {
        expect(safeNextPath(value)).toBe("/manuals");
      }
    }
  });

  it.each([
    "/",
    "/manuals/업무?q=a%20b#part",
    "/manuals?next=https://app.invalid/#part",
    "/manuals?q=%09%0a%0d",
  ])("preserves valid path %s and its origin", (value) => {
    const result = safeNextPath(value);
    expect(result).toBe(value);
    expect(new URL(result, "https://app.invalid").origin).toBe("https://app.invalid");
  });
});
