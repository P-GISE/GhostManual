import { createHash } from "node:crypto";
import { z } from "zod";
import { openUserSession } from "./accounts.ts";
import { transaction } from "./db.ts";
import { AppError } from "./errors.ts";
import { safeNextPath } from "./next-path.ts";
import { freshToken, tokenHash } from "./session.ts";
import { newId } from "./types.ts";

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string };
type Exchange = (code: string, verifier: string) => Promise<GoogleProfile>;
const failed = () => new AppError("google_failed", 400, "구글 로그인을 완료하지 못했습니다.");
function settings() {
  const clientId = process.env["GOOGLE_CLIENT_ID"],
    clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret)
    throw new AppError("google_unavailable", 503, "구글 로그인이 아직 설정되지 않았습니다.");
  return {
    clientId,
    clientSecret,
    redirectUri: `${process.env["APP_ORIGIN"]}/api/auth/google/callback`,
  };
}
export async function startGoogle(nextPath: string): Promise<string> {
  const { clientId, redirectUri } = settings();
  const state = freshToken(),
    verifier = freshToken();
  await transaction(async (db) => {
    await db.query("DELETE FROM oauth_states WHERE expires_at<now()");
    await db.query(
      "INSERT INTO oauth_states(state_hash,verifier,next_path,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
      [tokenHash(state), verifier, safeNextPath(nextPath)],
    );
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}
const idTokenClaims = z.object({
  iss: z.enum(["https://accounts.google.com", "accounts.google.com"]),
  aud: z.string(),
  sub: z.string().min(1),
  email: z.string(),
  email_verified: z.boolean(),
  name: z.string().optional(),
});
// The ID token comes straight from Google's token endpoint over TLS, so its claims are trusted.
const exchangeWithGoogle: Exchange = async (code, verifier) => {
  const { clientId, clientSecret, redirectUri } = settings();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw failed();
  });
  if (!response.ok) throw failed();
  const idToken = z.object({ id_token: z.string() }).safeParse(await response.json());
  const payload = idToken.success ? idToken.data.id_token.split(".")[1] : undefined;
  const claims = idTokenClaims.safeParse(
    payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : null,
  );
  if (!claims.success || claims.data.aud !== clientId) throw failed();
  return {
    sub: claims.data.sub,
    email: claims.data.email,
    emailVerified: claims.data.email_verified,
    name: claims.data.name ?? "",
  };
};
export async function finishGoogle(
  state: string,
  code: string,
  exchange: Exchange = exchangeWithGoogle,
) {
  const consumed = await transaction(async (db) =>
    db.query<{ verifier: string; next_path: string }>(
      "DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING verifier,next_path",
      [tokenHash(state)],
    ),
  );
  const saved = consumed.rows[0];
  if (!saved || !code) throw failed();
  const profile = await exchange(code, saved.verifier);
  const email = z.email().max(254).safeParse(profile.email.trim().toLowerCase());
  if (!profile.emailVerified || !email.success) throw failed();
  const name = (profile.name.trim() || email.data.split("@")[0] || "사용자").slice(0, 40);
  const session = await transaction(async (db) => {
    const bySub = await db.query<{ id: string }>("SELECT id FROM users WHERE google_sub=$1", [
      profile.sub,
    ]);
    let userId = bySub.rows[0]?.id;
    if (!userId) {
      const byEmail = await db.query<{ id: string; email_verified_at: Date | null }>(
        "SELECT id,email_verified_at FROM users WHERE email=$1 FOR UPDATE",
        [email.data],
      );
      const existing = byEmail.rows[0];
      if (existing) {
        userId = existing.id;
        // An unverified password may belong to someone else who signed up first.
        if (existing.email_verified_at)
          await db.query("UPDATE users SET google_sub=$2 WHERE id=$1", [userId, profile.sub]);
        else {
          await db.query(
            "UPDATE users SET google_sub=$2,password_hash=NULL,email_verified_at=now() WHERE id=$1",
            [userId, profile.sub],
          );
          await db.query(
            "UPDATE email_verifications SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
            [userId],
          );
        }
      } else {
        userId = newId();
        await db.query(
          "INSERT INTO users(id,email,name,google_sub,email_verified_at) VALUES($1,$2,$3,$4,now())",
          [userId, email.data, name, profile.sub],
        );
      }
    }
    return openUserSession(db, userId);
  });
  return { ...session, nextPath: saved.next_path };
}
