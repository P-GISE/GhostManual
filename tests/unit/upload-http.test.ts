import { expect, it } from "vitest";
import { readBody } from "../../src/lib/http.ts";

it("bounds streamed bodies without trusting content-length", async () => {
  const request = new Request("http://localhost/api/sources", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=example" },
    body: "x".repeat(300001),
  });
  await expect(readBody(request, 300000)).rejects.toMatchObject({ httpStatus: 413 });
});
