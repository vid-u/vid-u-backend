import type { Request } from "express";
import { SESSION_COOKIE_NAME } from "./auth-cookie.js";
import { googlePkceCookieName } from "../services/auth.service.js";

/** Safe request context for auth/OAuth logs (no tokens or cookie values). */
export function authRequestContext(req: Request): Record<string, string | boolean | string[] | undefined> {
  const cookieNames = req.cookies ? Object.keys(req.cookies as Record<string, unknown>) : [];
  return {
    origin: req.get("origin") ?? undefined,
    referer: truncateHeader(req.get("referer"), 160),
    hasSessionCookie: Boolean(req.cookies?.[SESSION_COOKIE_NAME]),
    hasGooglePkceCookie: Boolean(req.cookies?.[googlePkceCookieName]),
    cookieNames: cookieNames.length ? cookieNames : undefined,
    userAgent: truncateHeader(req.get("user-agent"), 120),
  };
}

function truncateHeader(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
