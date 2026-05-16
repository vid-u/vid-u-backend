import { env } from "./env.js";

/** First SPA origin from `FRONTEND_URL` (used for Xendit redirect URLs). */
export function getFrontendAppOrigin(): string {
  const first = env.FRONTEND_URL?.split(",")[0]?.trim();
  return first ?? "http://localhost:5173";
}

/** SPA path after fund / top-up checkout (budget tab + funding outcome). */
export function brandCampaignFundingRedirectPath(
  campaignId: string,
  outcome: "success" | "failed",
): string {
  return `/brand/campaigns/${campaignId}?tab=budget&funding=${outcome}`;
}

export function brandCampaignFundingRedirectUrl(
  campaignId: string,
  outcome: "success" | "failed",
): string {
  return `${getFrontendAppOrigin()}${brandCampaignFundingRedirectPath(campaignId, outcome)}`;
}
