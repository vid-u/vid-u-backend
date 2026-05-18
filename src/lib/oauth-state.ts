import { createSecretKey } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env.js";

export type OAuthStatePlatform = "tiktok" | "facebook";

function stateSigningKey(): ReturnType<typeof createSecretKey> {
  if (env.OAUTH_STATE_SECRET && env.OAUTH_STATE_SECRET.length >= 32) {
    return createSecretKey(Buffer.from(env.OAUTH_STATE_SECRET, "utf8").subarray(0, 32));
  }
  if (env.TOKEN_ENCRYPTION_KEY && env.TOKEN_ENCRYPTION_KEY.length >= 64) {
    return createSecretKey(Buffer.from(env.TOKEN_ENCRYPTION_KEY.slice(0, 64), "hex"));
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Set OAUTH_STATE_SECRET (first 32 UTF-8 bytes used as HS256 key) or TOKEN_ENCRYPTION_KEY for OAuth CSRF state",
    );
  }
  return createSecretKey(Buffer.from("dev-vidu-oauth-state-key-32bytes!", "utf8"));
}

export type OAuthStatePayload = {
  userId: string;
  platform: OAuthStatePlatform;
  /** TikTok PKCE code_verifier (embedded so HTTPS tunnel callbacks work without a cookie). */
  codeVerifier?: string;
};

export async function signOAuthState(
  userId: string,
  platform: OAuthStatePlatform,
  options?: { codeVerifier?: string },
): Promise<string> {
  const key = stateSigningKey();
  const claims: Record<string, string> = { sub: userId, p: platform };
  if (options?.codeVerifier) {
    claims.cv = options.codeVerifier;
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key);
}

export async function verifyOAuthState(state: string | undefined): Promise<OAuthStatePayload | null> {
  if (!state) return null;
  try {
    const key = stateSigningKey();
    const { payload } = await jwtVerify(state, key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    if (payload.p !== "tiktok" && payload.p !== "facebook") return null;
    const codeVerifier = typeof payload.cv === "string" ? payload.cv : undefined;
    return { userId: payload.sub, platform: payload.p, codeVerifier };
  } catch {
    return null;
  }
}

/** Guest Google login — PKCE in state when start/callback hosts differ (tunnel vs localhost). */
export async function signGoogleOAuthState(codeVerifier: string): Promise<string> {
  const key = stateSigningKey();
  return new SignJWT({ p: "google", cv: codeVerifier })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

export async function verifyGoogleOAuthState(state: string | undefined): Promise<string | null> {
  if (!state) return null;
  try {
    const key = stateSigningKey();
    const { payload } = await jwtVerify(state, key, { algorithms: ["HS256"] });
    if (payload.p !== "google") return null;
    return typeof payload.cv === "string" ? payload.cv : null;
  } catch {
    return null;
  }
}
