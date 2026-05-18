import type { Request, Response } from "express";
import { clearSessionCookie, SESSION_COOKIE_NAME, setSessionCookie } from "../lib/auth-cookie.js";
import { sendSuccess } from "../utils/api-response.js";
import { verifyGoogleOAuthState } from "../lib/oauth-state.js";
import { logger } from "../utils/logger.js";
import {
  clearGooglePkceCookie,
  completeGoogleOAuth,
  googlePkceCookieName,
  sendEmailOtp,
  startGoogleOAuth,
  verifyEmailOtp,
} from "../services/auth.service.js";
import { env, getPublicApiUrl } from "../lib/env.js";
import { authRequestContext } from "../lib/auth-request-log.js";
import { oauthFrontendBase } from "../lib/oauth-frontend.js";

/** Read-only: verify deployed OAuth URL alignment (no secrets). */
export function getGoogleOAuthConfig(_req: Request, res: Response): void {
  sendSuccess(res, {
    publicApiUrl: getPublicApiUrl(),
    googleCallbackUrl: `${getPublicApiUrl()}/auth/google/callback`,
    frontendRedirectBase: oauthFrontendBase(),
    nodeEnv: env.NODE_ENV,
  });
}

export async function postEmailSendCode(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };
  await sendEmailOtp(email);
  sendSuccess(res, { ok: true });
}

export async function postEmailVerify(req: Request, res: Response): Promise<void> {
  const { email, code } = req.body as { email: string; code: string };
  const session = await verifyEmailOtp(email, code);
  setSessionCookie(res, session.accessToken);
  sendSuccess(res, {
    requiresRoleSelection: session.requiresRoleSelection,
  });
}

export async function getGoogleStart(req: Request, res: Response): Promise<void> {
  logger.info("Google OAuth start request", authRequestContext(req));
  await startGoogleOAuth(res);
}

export async function getGoogleCallback(req: Request, res: Response): Promise<void> {
  const base = oauthFrontendBase();
  const q = req.query as Record<string, string | undefined>;

  const pkceParam = typeof q.pkce === "string" ? q.pkce : undefined;
  const cookieVerifier =
    typeof req.cookies?.[googlePkceCookieName] === "string"
      ? req.cookies[googlePkceCookieName]
      : undefined;

  logger.info("Google OAuth callback hit", {
    ...authRequestContext(req),
    hasCode: Boolean(q.code),
    hasError: Boolean(q.error),
    hasSupabaseState: Boolean(q.state),
    hasPkceParam: Boolean(pkceParam),
    pkceParamLength: pkceParam?.length,
    hasPkceCookie: Boolean(cookieVerifier),
    frontendRedirectBase: base,
  });

  if (q.error) {
    clearGooglePkceCookie(res);
    logger.warn("Google OAuth provider error", {
      error: q.error,
      description: q.error_description,
    });
    res.redirect(
      302,
      `${base}/auth?oauth=error&reason=${encodeURIComponent(q.error_description ?? q.error)}`,
    );
    return;
  }

  const code = typeof q.code === "string" ? q.code : "";
  const pkceRefVerifier = await verifyGoogleOAuthState(pkceParam);
  const verifier = pkceRefVerifier ?? cookieVerifier;

  if (!code) {
    clearGooglePkceCookie(res);
    logger.warn("Google OAuth callback missing code", authRequestContext(req));
    res.redirect(302, `${base}/auth?oauth=error&reason=missing_code`);
    return;
  }

  if (!verifier) {
    clearGooglePkceCookie(res);
    logger.warn("Google OAuth missing PKCE verifier", {
      ...authRequestContext(req),
      pkceJwtValid: Boolean(pkceRefVerifier),
      hasPkceParam: Boolean(pkceParam),
      hasPkceCookie: Boolean(cookieVerifier),
    });
    res.redirect(302, `${base}/auth?oauth=error&reason=missing_pkce_verifier`);
    return;
  }

  try {
    const session = await completeGoogleOAuth(code, verifier);
    clearGooglePkceCookie(res);
    setSessionCookie(res, session.accessToken);
    const url = new URL("/", base);
    if (session.requiresRoleSelection) {
      url.searchParams.set("requires_role", "1");
    }
    logger.info("Google OAuth succeeded — redirecting to SPA", {
      requiresRoleSelection: session.requiresRoleSelection,
      pkceFromRedirect: Boolean(pkceRefVerifier),
      pkceFromCookie: Boolean(cookieVerifier && !pkceRefVerifier),
      redirectTo: url.toString(),
      sessionCookieSet: true,
    });
    res.redirect(302, url.toString());
  } catch (err) {
    clearGooglePkceCookie(res);
    const message = err instanceof Error ? err.message : "google_oauth_failed";
    logger.error("Google OAuth callback failed", { error: message });
    res.redirect(302, `${base}/auth?oauth=error&reason=${encodeURIComponent(message)}`);
  }
}

export async function postSignOut(req: Request, res: Response): Promise<void> {
  logger.info("Auth sign-out", {
    ...authRequestContext(req),
    hadSessionCookie: Boolean(req.cookies?.[SESSION_COOKIE_NAME]),
  });
  clearSessionCookie(res);
  sendSuccess(res, { ok: true });
}
