import type { Request, Response } from "express";
import { extractBearer } from "./supabase-auth.js";
import { env } from "./env.js";

/** HttpOnly session cookie — Supabase JWT access token (not readable by JS). */
export const SESSION_COOKIE_NAME = "vidu_session";

/** Align with Supabase JWT expiry (default 3600s). */
const SESSION_COOKIE_MAX_AGE_MS = 60 * 60 * 1000;

function cookieSecure(): boolean {
  return env.NODE_ENV === "production";
}

function cookieSameSite(): "lax" | "none" | "strict" {
  const v = process.env.AUTH_COOKIE_SAME_SITE?.toLowerCase();
  if (v === "none" || v === "strict" || v === "lax") return v;
  return "lax";
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: cookieSameSite(),
    path: "/",
  } as const;
}

export function setSessionCookie(res: Response, accessToken: string): void {
  res.cookie(SESSION_COOKIE_NAME, accessToken, {
    ...sessionCookieOptions(),
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
}

/** Cookie first; Bearer retained for Postman / tooling only. */
export function extractSessionToken(req: Request): string | undefined {
  const raw = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return extractBearer(req.headers.authorization);
}
