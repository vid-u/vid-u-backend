import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { UnauthorizedError } from "../utils/errors.js";
import { env, getSupabaseJwksUrl } from "./env.js";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  const url = getSupabaseJwksUrl();
  if (!url) {
    throw new Error("SUPABASE_URL is required for JWT verification (JWKS)");
  }
  jwks ??= createRemoteJWKSet(new URL(url));
  return jwks;
}

export type SupabaseJwtPayload = JWTPayload & {
  sub: string;
  email?: string;
  role?: string;
  user_metadata?: { role?: string; email?: string; full_name?: string; name?: string; avatar_url?: string };
  app_metadata?: { role?: string; vidu_role?: "brand" | "creator" };
};

/**
 * Verifies Supabase-issued JWT (RS256 via JWKS, or HS256 if SUPABASE_JWT_SECRET set for local dev).
 */
export async function verifySupabaseJwt(token: string): Promise<SupabaseJwtPayload> {
  if (env.SUPABASE_JWT_SECRET) {
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    return payload as SupabaseJwtPayload;
  }
  if (!env.SUPABASE_URL) {
    throw new UnauthorizedError("Auth is not configured (SUPABASE_URL)");
  }
  const issuer = `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer,
  });
  return payload as SupabaseJwtPayload;
}

export function extractBearer(header?: string): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

export function jwtRoleHint(payload: SupabaseJwtPayload): string | undefined {
  const r = payload.role ?? payload.user_metadata?.role ?? payload.app_metadata?.role;
  return typeof r === "string" ? r : undefined;
}
