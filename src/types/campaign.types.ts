import type { Prisma } from "../generated/prisma/client.js";
import type { CampaignStatus, UserRole } from "../generated/prisma/enums.js";

/** Shape of `campaign.severityRewards` JSON when parsed (midpoint payout calculation). */
export type SeverityRewards = {
  critical?: { min: number | string; max: number | string };
  high?: { min: number | string; max: number | string };
  medium?: { min: number | string; max: number | string };
  mild?: { min: number | string; max: number | string };
};

/** Prisma campaign row; `campaignToJson` stringifies `Decimal` fields for JSON. */
export type CampaignRow = {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  scope: string | null;
  status: CampaignStatus;
  budget: Prisma.Decimal;
  budgetRemaining: Prisma.Decimal;
  availableBalance: Prisma.Decimal;
  allocatedBalance: Prisma.Decimal;
  deviceRequirements: string[];
  visibility: string;
  listed: boolean;
  escrowPda: string | null;
  reviewWindowDays: number | null;
  severityRewards: Prisma.JsonValue | null;
  creationFeePaid: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ListCampaignsOptions = {
  authUserId?: string;
  authRole?: UserRole;
  mine?: boolean;
  page?: number;
  limit?: number;
};
