import type { Request, Response } from "express";
import { env } from "../lib/env.js";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state.js";
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

function oauthFrontendBase(): string {
  const raw = env.FRONTEND_URL ?? "http://localhost:5173";
  return raw.split(",")[0]!.trim().replace(/\/$/, "");
}

export async function getTikTokOAuthStart(req: Request, res: Response): Promise<void> {
  assertTikTokConfigured();
  const state = await signOAuthState(req.dbUser!.id, "tiktok");
  res.redirect(302, buildTikTokAuthorizeUrl(state));
}

export async function getTikTokOAuthCallback(req: Request, res: Response): Promise<void> {
  const base = oauthFrontendBase();
  const q = req.query as Record<string, string | undefined>;
  if (q.error) {
    res.redirect(
      302,
      `${base}?oauth=error&platform=tiktok&reason=${encodeURIComponent(q.error_description ?? q.error)}`,
    );
    return;
  }
  const st = await verifyOAuthState(typeof q.state === "string" ? q.state : undefined);
  if (!st || st.platform !== "tiktok") {
    res.redirect(302, `${base}?oauth=error&platform=tiktok&reason=invalid_state`);
    return;
  }
  const code = typeof q.code === "string" ? q.code : undefined;
  if (!code) {
    res.redirect(302, `${base}?oauth=error&platform=tiktok&reason=missing_code`);
    return;
  }
  try {
    const tok = await exchangeTikTokCode(code);
    await upsertTikTokCreatorAccount({
      userId: st.userId,
      accessToken: tok.accessToken,
      refreshToken: tok.refreshToken,
      expiresIn: tok.expiresIn,
      openIdFromToken: tok.openId,
    });
    res.redirect(302, `${base}?oauth=success&platform=tiktok`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth_failed";
    res.redirect(302, `${base}?oauth=error&platform=tiktok&reason=${encodeURIComponent(msg)}`);
  }
}

export async function getMetaOAuthStart(req: Request, res: Response): Promise<void> {
  assertMetaConfigured();
  const state = await signOAuthState(req.dbUser!.id, "facebook");
  res.redirect(302, buildMetaAuthorizeUrl(state));
}

export async function getMetaOAuthCallback(req: Request, res: Response): Promise<void> {
  const base = oauthFrontendBase();
  const q = req.query as Record<string, string | undefined>;
  if (q.error) {
    res.redirect(
      302,
      `${base}?oauth=error&platform=facebook&reason=${encodeURIComponent(q.error_description ?? q.error)}`,
    );
    return;
  }
  const st = await verifyOAuthState(typeof q.state === "string" ? q.state : undefined);
  if (!st || st.platform !== "facebook") {
    res.redirect(302, `${base}?oauth=error&platform=facebook&reason=invalid_state`);
    return;
  }
  const code = typeof q.code === "string" ? q.code : undefined;
  if (!code) {
    res.redirect(302, `${base}?oauth=error&platform=facebook&reason=missing_code`);
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
    res.redirect(302, `${base}?oauth=success&platform=facebook`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth_failed";
    res.redirect(302, `${base}?oauth=error&platform=facebook&reason=${encodeURIComponent(msg)}`);
  }
}
