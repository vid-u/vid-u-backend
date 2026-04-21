import type { Prisma } from "../generated/prisma/client.js";

/** Row shape from `getCampaignActivities` raw SQL (`$queryRaw`). */
export type CampaignActivityQueryRow = {
  id: string;
  activity_type: string;
  occurred_at: Date;
  campaign_id: string;
  campaign_title: string;
  user_id: string;
  display_name: string | null;
  wallet_address: string;
  avatar_url: string | null;
  submission_title: string | null;
  submission_kind: string | null;
  amount_usdc: Prisma.Decimal | null;
};
