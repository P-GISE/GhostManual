import { expect, it, vi } from "vitest";
import { endpoint, json, readJson, sessionCookie } from "../../src/lib/http.ts";

it("rejects foreign origin before mutation", async () => {
  vi.stubEnv("APP_ORIGIN", "https://ghostmanual.pigs0516.com");
  let calls = 0;
  const response = await endpoint(
    new Request("https://ghostmanual.pigs0516.com/api/sources", {
      method: "POST",
      headers: { origin: "https://other.example" },
    }),
    async () => {
      calls++;
      return json({ ok: true });
    },
  );
  expect(response.status).toBe(403);
  expect(calls).toBe(0);
  expect(response.headers.get("cache-control")).toContain("no-store");
  vi.unstubAllEnvs();
});
it("requires JSON and bounded body bytes", async () => {
  await expect(
    readJson(new Request("http://localhost", { method: "POST", body: "x" })),
  ).rejects.toMatchObject({ httpStatus: 415 });
  await expect(
    readJson(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(1048577) }),
      }),
    ),
  ).rejects.toMatchObject({ httpStatus: 413 });
});
it("uses secure private cookies on HTTPS", () => {
  vi.stubEnv("APP_ORIGIN", "https://ghostmanual.pigs0516.com");
  expect(sessionCookie("test", new Date())).toContain("HttpOnly; SameSite=Lax");
  expect(sessionCookie("test", new Date())).toContain("Secure");
  vi.unstubAllEnvs();
});
