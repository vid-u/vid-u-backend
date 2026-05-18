import type { Request, Response } from "express";
import { env } from "../lib/env.js";
import { creatorPlatformOAuthRedirectUrl } from "../lib/oauth-frontend.js";
import { generatePkcePair } from "../lib/pkce.js";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state.js";
import { sendSuccess } from "../utils/api-response.js";
import { logger } from "../utils/logger.js";
import {
  assertTikTokConfigured,
  buildTikTokAuthorizeUrl,
  exchangeTikTokCode,
  upsertTikTokCreatorAccount,
} from "../services/tiktok-platform.service.js";
import {
  assertMetaConfigured,
  buildMetaAuthorizeUrl,
  exchangeMetaLongLivedUserToken,
  exchangeMetaShortLivedCode,
  upsertMetaCreatorAccount,
} from "../services/meta-platform.service.js";

const TIKTOK_PKCE_COOKIE = "vidu_tiktok_pkce_verifier";
const TIKTOK_PKCE_MAX_AGE_MS = 15 * 60 * 1000;

function setTikTokPkceCookie(res: Response, verifier: string): void {
  res.cookie(TIKTOK_PKCE_COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: TIKTOK_PKCE_MAX_AGE_MS,
    path: "/",
  });
}

function clearTikTokPkceCookie(res: Response): void {
  res.clearCookie(TIKTOK_PKCE_COOKIE, { path: "/" });
}

function logTikTokOAuthCallback(
  outcome: string,
  meta?: Record<string, string | boolean | undefined>,
): void {
  logger.info("TikTok OAuth callback", { outcome, ...meta });
}

export async function getTikTokOAuthStart(req: Request, res: Response): Promise<void> {
  assertTikTokConfigured();
  const { verifier, challenge } = generatePkcePair();
  const state = await signOAuthState(req.dbUser!.id, "tiktok", { codeVerifier: verifier });
  const authorizeUrl = buildTikTokAuthorizeUrl(state, challenge);
  setTikTokPkceCookie(res, verifier); // fallback when redirect_uri is same host as /start
  if (req.headers.accept?.includes("application/json")) {
    sendSuccess(res, { authorizeUrl });
    return;
  }
  res.redirect(302, authorizeUrl);
}

export async function getTikTokOAuthCallback(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const hasCode = typeof q.code === "string";
  const hasState = typeof q.state === "string";
  if (q.error) {
    const redirectTo = creatorPlatformOAuthRedirectUrl({
      outcome: "error",
      platform: "tiktok",
      reason: q.error_description ?? q.error,
    });
    logTikTokOAuthCallback("provider_error", {
      providerError: q.error,
      hasCode,
      hasState,
      redirectTo,
    });
    clearTikTokPkceCookie(res);
    res.redirect(302, redirectTo);
    return;
  }
  const st = await verifyOAuthState(typeof q.state === "string" ? q.state : undefined);
  if (!st || st.platform !== "tiktok") {
    const redirectTo = creatorPlatformOAuthRedirectUrl({
      outcome: "error",
      platform: "tiktok",
      reason: "invalid_state",
    });
    logTikTokOAuthCallback("invalid_state", { hasCode, hasState, redirectTo });
    clearTikTokPkceCookie(res);
    res.redirect(302, redirectTo);
    return;
  }
  const code = typeof q.code === "string" ? q.code : undefined;
  if (!code) {
    const redirectTo = creatorPlatformOAuthRedirectUrl({
      outcome: "error",
      platform: "tiktok",
      reason: "missing_code",
    });
    logTikTokOAuthCallback("missing_code", { userId: st.userId, redirectTo });
    clearTikTokPkceCookie(res);
    res.redirect(302, redirectTo);
    return;
  }
  const codeVerifier =
    st.codeVerifier ?? (req.cookies?.[TIKTOK_PKCE_COOKIE] as string | undefined);
  if (!codeVerifier) {
    const redirectTo = creatorPlatformOAuthRedirectUrl({
      outcome: "error",
      platform: "tiktok",
      reason: "missing_pkce_verifier",
    });
    logTikTokOAuthCallback("missing_pkce_verifier", {
      userId: st.userId,
      stateHadVerifier: Boolean(st.codeVerifier),
      hasPkceCookie: Boolean(req.cookies?.[TIKTOK_PKCE_COOKIE]),
      redirectTo,
    });
    clearTikTokPkceCookie(res);
    res.redirect(302, redirectTo);
    return;
  }
  try {
    const tok = await exchangeTikTokCode(code, codeVerifier);
    clearTikTokPkceCookie(res);
    await upsertTikTokCreatorAccount({
      userId: st.userId,
      accessToken: tok.accessToken,
      refreshToken: tok.refreshToken,
      expiresIn: tok.expiresIn,
      openIdFromToken: tok.openId,
    });
    const redirectTo = creatorPlatformOAuthRedirectUrl({ outcome: "success", platform: "tiktok" });
    logTikTokOAuthCallback("success", { userId: st.userId, redirectTo });
    res.redirect(302, redirectTo);
  } catch (e) {
    clearTikTokPkceCookie(res);
    const msg = e instanceof Error ? e.message : "oauth_failed";
    const redirectTo = creatorPlatformOAuthRedirectUrl({
      outcome: "error",
      platform: "tiktok",
      reason: msg,
    });
    logTikTokOAuthCallback("failed", { userId: st.userId, reason: msg, redirectTo });
    res.redirect(302, redirectTo);
  }
}

export async function getMetaOAuthStart(req: Request, res: Response): Promise<void> {
  assertMetaConfigured();
  const state = await signOAuthState(req.dbUser!.id, "facebook");
  const authorizeUrl = buildMetaAuthorizeUrl(state);
  if (req.headers.accept?.includes("application/json")) {
    sendSuccess(res, { authorizeUrl });
    return;
  }
  res.redirect(302, authorizeUrl);
}

export async function getMetaOAuthCallback(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  if (q.error) {
    res.redirect(
      302,
      creatorPlatformOAuthRedirectUrl({
        outcome: "error",
        platform: "facebook",
        reason: q.error_description ?? q.error,
      }),
    );
    return;
  }
  const st = await verifyOAuthState(typeof q.state === "string" ? q.state : undefined);
  if (!st || st.platform !== "facebook") {
    res.redirect(
      302,
      creatorPlatformOAuthRedirectUrl({
        outcome: "error",
        platform: "facebook",
        reason: "invalid_state",
      }),
    );
    return;
  }
  const code = typeof q.code === "string" ? q.code : undefined;
  if (!code) {
    res.redirect(
      302,
      creatorPlatformOAuthRedirectUrl({
        outcome: "error",
        platform: "facebook",
        reason: "missing_code",
      }),
    );
    return;
  }
  try {
    const short = await exchangeMetaShortLivedCode(code);
    const long = await exchangeMetaLongLivedUserToken(short.accessToken);
    await upsertMetaCreatorAccount({
      userId: st.userId,
      accessToken: long.accessToken,
      expiresIn: long.expiresIn,
    });
    res.redirect(
      302,
      creatorPlatformOAuthRedirectUrl({ outcome: "success", platform: "facebook" }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth_failed";
    res.redirect(
      302,
      creatorPlatformOAuthRedirectUrl({ outcome: "error", platform: "facebook", reason: msg }),
    );
  }
}
