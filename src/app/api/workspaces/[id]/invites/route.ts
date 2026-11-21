import { z } from "zod";
import { endpoint, json, readJson, requestSession } from "../../../../../lib/http.ts";
import { limitRequest } from "../../../../../lib/rate-limit.ts";
import { inviteMember } from "../../../../../lib/teams.ts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    // 초대는 메일을 보내므로 인증 메일 다시 보내기와 같은 한도를 쓴다.
    await limitRequest(request, "resend");
    const ctx = await requestSession(request);
    const input = z.strictObject({ email: z.string().max(320) }).parse(await readJson(request));
    return json(
      await inviteMember(ctx, z.uuid().parse((await context.params).id), input.email),
      201,
    );
  });
}
