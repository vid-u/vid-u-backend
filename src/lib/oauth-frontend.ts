import { env } from "./env.js";

/** First SPA origin from `FRONTEND_URL` (OAuth post-login redirect base). */
export function oauthFrontendBase(): string {
  const raw = env.FRONTEND_URL ?? "http://localhost:5173";
  return raw.split(",")[0]!.trim().replace(/\/$/, "");
}

export type CreatorPlatformOAuthPlatform = "tiktok" | "facebook";

/** Post-connect redirect for creator TikTok / Meta OAuth (`/account` + oauth query params). */
export function creatorPlatformOAuthRedirectUrl(params: {
  outcome: "success" | "error";
  platform: CreatorPlatformOAuthPlatform;
  reason?: string;
}): string {
  const u = new URL("/account", oauthFrontendBase());
  u.searchParams.set("oauth", params.outcome);
  u.searchParams.set("platform", params.platform);
  if (params.reason) {
    u.searchParams.set("reason", params.reason);
  }
  return u.href;
}
