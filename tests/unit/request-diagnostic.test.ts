import ky, { NetworkError, TimeoutError } from "ky";
import { expect, it } from "vitest";
import { z } from "zod";
import { requestDiagnostic } from "../../src/lib/request-diagnostic.ts";

it("keeps only stage, status and fixed categories, never HTTP bodies or credentials", async () => {
  let failure: unknown;
  try {
    await ky.get("https://fixture.invalid/private?token=DO_NOT_COPY", {
      retry: 0,
      fetch: async () =>
        Response.json(
          { error: { code: "SECRET_CODE", message: "PRIVATE_BODY" } },
          { status: 401, headers: { "set-cookie": "private=DO_NOT_COPY" } },
        ),
    });
  } catch (error) {
    failure = error;
  }
  expect(requestDiagnostic("session", failure)).toEqual({
    stage: "session",
    status: 401,
    category: "http",
    retryable: false,
  });
});

it("separates timeout, transport, schema and success without exception text", () => {
  expect(
    requestDiagnostic("session", new NetworkError(new Request("https://fixture.invalid/private"))),
  ).toEqual({ stage: "session", status: null, category: "network", retryable: true });
  expect(
    requestDiagnostic("session", new TimeoutError(new Request("https://fixture.invalid"))),
  ).toEqual({ stage: "session", status: null, category: "timeout", retryable: true });
  expect(requestDiagnostic("create", new TypeError("SECRET_BODY"))).toEqual({
    stage: "create",
    status: null,
    category: "network",
    retryable: true,
  });
  const parsed = z.string().safeParse(null);
  expect(requestDiagnostic("session", parsed.error, 200)).toEqual({
    stage: "session",
    status: 200,
    category: "response",
    retryable: false,
  });
  expect(requestDiagnostic("create", undefined, 201)).toEqual({
    stage: "create",
    status: 201,
    category: "success",
    retryable: false,
  });
  expect(JSON.stringify(requestDiagnostic("sources", new Error("PRIVATE_BODY")))).not.toContain(
    "PRIVATE_BODY",
  );
});
