import ky from "ky";
import { expect, it } from "vitest";
import { message } from "../../src/lib/client.ts";

it("uses an already parsed ky HTTP error without rereading the response", async () => {
  let error: unknown;
  try {
    await ky.get("https://fixture.example", {
      retry: 0,
      fetch: async () =>
        Response.json({ error: { message: "오늘의 사용 한도입니다." } }, { status: 429 }),
    });
  } catch (caught) {
    error = caught;
  }
  await expect(message(error)).resolves.toContain("오늘의 사용 한도입니다.");
});
