import { expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/passwords.ts";

it("salts each hash and never stores the password", async () => {
  const first = await hashPassword("correct horse 9");
  const second = await hashPassword("correct horse 9");
  expect(first).not.toBe(second);
  expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
  expect(first).not.toContain("correct horse 9");
});
it("verifies only the original password", async () => {
  const stored = await hashPassword("correct horse 9");
  expect(await verifyPassword("correct horse 9", stored)).toBe(true);
  expect(await verifyPassword("correct horse 8", stored)).toBe(false);
});
it("rejects malformed stored hashes", async () => {
  expect(await verifyPassword("anything", "garbage")).toBe(false);
});
