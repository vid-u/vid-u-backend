import type { Response } from "express";
import { getPublicApiUrl, env } from "../lib/env.js";
import { generatePkcePair } from "../lib/pkce.js";
import { getSupabaseAnonClient, getSupabaseServiceClient } from "../lib/supabaseAuth.js";
import { verifySupabaseJwt } from "../lib/supabase-auth.js";
import { ensureRoleProfile, ensureUserFromJwt, readViduRoleFromJwt } from "./user.service.js";
import type { UserRole } from "../generated/prisma/client.js";

const COOKIE_VERIFIER = "vidu_google_pkce_verifier";
const COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function assertSupabaseConfigured(): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured");
  }
}

export async function sendEmailOtp(email: string): Promise<void> {
  assertSupabaseConfigured();
  const supabase = getSupabaseAnonClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    throw new Error(error.message);
  }
}

export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<{ accessToken: string; refreshToken: string | null; requiresRoleSelection: boolean }> {
  assertSupabaseConfigured();
  const supabase = getSupabaseAnonClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (error || !data.session?.access_token) {
    throw new Error(error?.message ?? "Invalid code");
  }
  const payload = await verifySupabaseJwt(data.session.access_token);
  await ensureUserFromJwt(payload);
  const role = readViduRoleFromJwt(payload);
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    requiresRoleSelection: role === null,
  };
}

export function startGoogleOAuth(res: Response): void {
  assertSupabaseConfigured();
  const { verifier, challenge } = generatePkcePair();
  const redirectUri = `${getPublicApiUrl()}/auth/google/callback`;
  const authorize = new URL(`${env.SUPABASE_URL}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", redirectUri);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("apikey", env.SUPABASE_ANON_KEY as string);

  res.cookie(COOKIE_VERIFIER, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
  res.redirect(302, authorize.toString());
}

export async function completeGoogleOAuth(
  code: string,
  verifier: string | undefined,
): Promise<{ accessToken: string; refreshToken: string | null; requiresRoleSelection: boolean }> {
  assertSupabaseConfigured();
  if (!verifier) {
    throw new Error("Missing PKCE verifier cookie");
  }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY as string}`,
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string | null;
  };
  if (!json.access_token) {
    throw new Error("Google token exchange returned no access_token");
  }
  const payload = await verifySupabaseJwt(json.access_token);
  await ensureUserFromJwt(payload);
  const role = readViduRoleFromJwt(payload);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    requiresRoleSelection: role === null,
  };
}

export function clearGooglePkceCookie(res: Response): void {
  res.clearCookie(COOKIE_VERIFIER, { path: "/" });
}

export const googlePkceCookieName = COOKIE_VERIFIER;

export async function setUserRole(userId: string, role: UserRole): Promise<void> {
  await ensureRoleProfile(userId, role);
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { vidu_role: role },
  });
  if (error) {
    throw new Error(error.message);
  }
}
