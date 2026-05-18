import type { Request, Response } from "express";
import { clearSessionCookie, setSessionCookie } from "../lib/auth-cookie.js";
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
import { env } from "../lib/env.js";

function oauthFrontendBase(): string {
  const raw = env.FRONTEND_URL ?? "http://localhost:5173";
  return raw.split(",")[0]!.trim().replace(/\/$/, "");
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

export async function getGoogleStart(_req: Request, res: Response): Promise<void> {
  await startGoogleOAuth(res);
}

export async function getGoogleCallback(req: Request, res: Response): Promise<void> {
  const base = oauthFrontendBase();
  const q = req.query as Record<string, string | undefined>;

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
  const stateVerifier = await verifyGoogleOAuthState(typeof q.state === "string" ? q.state : undefined);
  const cookieVerifier =
    typeof req.cookies?.[googlePkceCookieName] === "string"
      ? req.cookies[googlePkceCookieName]
      : undefined;
  const verifier = stateVerifier ?? cookieVerifier;

  if (!code) {
    clearGooglePkceCookie(res);
    logger.warn("Google OAuth callback missing code");
    res.redirect(302, `${base}/auth?oauth=error&reason=missing_code`);
    return;
  }

  if (!verifier) {
    clearGooglePkceCookie(res);
    logger.warn("Google OAuth callback missing PKCE verifier", {
      hasState: Boolean(q.state),
      hasCookie: Boolean(cookieVerifier),
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
    logger.info("Google OAuth login succeeded", {
      requiresRoleSelection: session.requiresRoleSelection,
      pkceFromState: Boolean(stateVerifier),
    });
    res.redirect(302, url.toString());
  } catch (err) {
    clearGooglePkceCookie(res);
    const message = err instanceof Error ? err.message : "google_oauth_failed";
    logger.error("Google OAuth callback failed", { error: message });
    res.redirect(302, `${base}/auth?oauth=error&reason=${encodeURIComponent(message)}`);
  }
}

export async function postSignOut(_req: Request, res: Response): Promise<void> {
  clearSessionCookie(res);
  sendSuccess(res, { ok: true });
}
