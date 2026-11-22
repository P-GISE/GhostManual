import { z } from "zod";
import { endpoint, json, readCookie, readJson, sessionCookie } from "../../../../lib/http.ts";
import { switchWorkspace } from "../../../../lib/teams.ts";

// 문서함 전환: 대상 문서함의 세션을 새로 만들고 로그인 쿠키를 그 세션으로 바꾼다. workspaceId가 null이면 내 문서함.
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const input = z
      .strictObject({ workspaceId: z.uuid().nullable() })
      .parse(await readJson(request));
    const session = await switchWorkspace(readCookie(request, "gm_owner"), input.workspaceId);
    const response = json({ workspaceId: session.workspaceId, expiresAt: session.expiresAt });
    response.headers.set("Set-Cookie", sessionCookie(session.token, session.expiresAt));
    return response;
  });
}
