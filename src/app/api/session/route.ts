import { endpoint, json, requestSession } from "../../../lib/http.ts";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const ctx = await requestSession(request, { allowPendingTerms: true });
    let termsRequired = false;
    await requestSession(request).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "terms_required")
        termsRequired = true;
      else throw error;
    });
    return json({
      role: ctx.role,
      expiresAt: ctx.expiresAt,
      manualId: ctx.manualId,
      termsRequired,
    });
  });
}
