import { ZodError } from "zod";
import { AppError } from "./errors.ts";
import { requireSession } from "./session.ts";
export const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: responseHeaders });
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== process.env["APP_ORIGIN"])
    throw new AppError("invalid_origin", 403, "허용되지 않은 요청입니다.");
}
export async function readBody(
  request: Request,
  maxBytes = 1048576,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("invalid_input", 422, "입력이 필요합니다.");
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AppError("payload_too_large", 413, "입력이 너무 큽니다.");
    }
    parts.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("invalid_content_type", 415, "JSON 요청이 필요합니다.");
  const bytes = await readBody(request);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError("invalid_json", 422, "입력을 확인하세요.");
  }
}
export async function requestSession(
  request: Request,
  options: { allowPendingTerms?: boolean } = {},
) {
  // Plain links (file downloads) cannot send headers, so `?view=shared` also selects the reader session.
  const reader =
    request.headers.get("x-ghost-role") === "reader" ||
    new URL(request.url).searchParams.get("view") === "shared";
  const name = reader ? "gm_reader" : "gm_owner";
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="));
  return requireSession(cookie?.slice(name.length + 1) ?? "", options);
}
export function sessionCookie(token: string, expiresAt: Date, reader = false) {
  return `${reader ? "gm_reader" : "gm_owner"}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${process.env["APP_ORIGIN"]?.startsWith("https:") ? "; Secure" : ""}`;
}
export function clearSessionCookies(response: Response) {
  response.headers.append("Set-Cookie", "gm_owner=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  response.headers.append("Set-Cookie", "gm_reader=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return response;
}
export async function endpoint(request: Request, work: () => Promise<Response>) {
  try {
    if (!["GET", "HEAD"].includes(request.method)) checkOrigin(request);
    return await work();
  } catch (error) {
    if (error instanceof AppError)
      return json(
        { error: { code: error.code, message: error.message, retryable: error.retryable } },
        error.httpStatus,
      );
    if (error instanceof ZodError)
      return json(
        {
          error: {
            code: "invalid_input",
            message: "입력 항목과 길이를 확인하세요.",
            retryable: false,
          },
        },
        422,
      );
    return json(
      {
        error: {
          code: "unavailable",
          message: "저장소에 연결할 수 없습니다. 입력을 유지하고 다시 시도하세요.",
          retryable: true,
        },
      },
      503,
    );
  }
}
