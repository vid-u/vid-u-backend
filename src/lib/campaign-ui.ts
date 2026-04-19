import type { Campaign, Prisma } from "../generated/prisma/client.js";
import {
  normalizeDeviceRequirements,
  type DeviceRequirementId,
} from "./device-requirements.js";
import { dec } from "./prisma.js";

export type PayoutStructureUi = {
  mild: { min: number; max: number };
  medium: { min: number; max: number };
  high: { min: number; max: number };
  critical: { min: number; max: number };
};

type SeverityRewardsJson = {
  mild?: { min?: number | string; max?: number | string };
  medium?: { min?: number | string; max?: number | string };
  high?: { min?: number | string; max?: number | string };
  critical?: { min?: number | string; max?: number | string };
};

function tierToNums(t: { min?: number | string; max?: number | string } | undefined) {
  if (!t) return { min: 0, max: 0 };
  const min = typeof t.min === "number" ? t.min : Number(t.min ?? 0);
  const max = typeof t.max === "number" ? t.max : Number(t.max ?? 0);
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}

/** Maps DB `severity_rewards` JSON to UI `payoutStructure`. */
export function severityRewardsToPayoutStructure(
  rewards: Prisma.JsonValue | null,
): PayoutStructureUi {
  if (!rewards || typeof rewards !== "object" || Array.isArray(rewards)) {
    return {
      mild: { min: 0, max: 50 },
      medium: { min: 50, max: 100 },
      high: { min: 100, max: 300 },
      critical: { min: 300, max: 500 },
    };
  }
  const r = rewards as SeverityRewardsJson;
  return {
    mild: tierToNums(r.mild),
    medium: tierToNums(r.medium),
    high: tierToNums(r.high),
    critical: tierToNums(r.critical),
  };
}

export function serializeCampaignUi(
  c: Campaign,
  opts: {
    companyName: string;
    /** Client org logo from `client_profiles.logo_url`. */
    logoUrl?: string | null;
    /** Total submissions (all kinds) for this campaign. */
    submissionsCount: number;
    /** Distinct testers who have submitted to this campaign. */
    uniqueTestersCount: number;
  },
) {
  const dl =
    c.downloadLinks &&
    typeof c.downloadLinks === "object" &&
    !Array.isArray(c.downloadLinks)
      ? (c.downloadLinks as Record<string, string>)
      : {};

  return {
    id: c.id,
    clientId: c.clientId,
    title: c.title,
    description: c.description ?? "",
    testScope: c.scope ?? "",
    outOfScope: c.outOfScope ?? undefined,
    inScopeTestCaseUrl: c.inScopeTestCaseUrl ?? undefined,
    disclosureGuidelines: c.disclosureGuidelines ?? undefined,
    rewardEligibility: c.rewardEligibility ?? undefined,
    downloadLinks: dl,
    startDate: c.startDate ? c.startDate.toISOString().slice(0, 10) : "",
    endDate: c.endDate ? c.endDate.toISOString().slice(0, 10) : undefined,
    isApproved: c.isApproved,
    isPrivate: c.visibility === "private",
    visibility: c.visibility,
    listed: c.listed,
    status: c.status,
    budget: Number(dec(c.budget) ?? "0"),
    budgetRemaining: Number(dec(c.budgetRemaining) ?? "0"),
    availableBalance: dec(c.availableBalance),
    allocatedBalance: dec(c.allocatedBalance),
    escrowPda: c.escrowPda,
    reviewWindowDays: c.reviewWindowDays,
    creationFeePaid: c.creationFeePaid,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    company: opts.companyName,
    logoUrl: opts.logoUrl?.trim() ? opts.logoUrl.trim() : undefined,
    payoutStructure: severityRewardsToPayoutStructure(c.severityRewards),
    deviceRequirements: normalizeDeviceRequirements(c.deviceRequirements),
    submissionsCount: opts.submissionsCount,
    /* Same value as submissionsCount; kept for older clients. */
    bugsSubmitted: opts.submissionsCount,
    uniqueTestersCount: opts.uniqueTestersCount,
  };
}

/** Public browse / dashboard cards — minimal fields + `stats` (no full detail payload). */
export type CampaignListPreview = {
  id: string;
  title: string;
  company: string;
  logoUrl?: string;
  status: string;
  description: string;
  deviceRequirements: DeviceRequirementId[];
  createdAt: string;
  stats: {
    /** Distinct testers who have submitted to this campaign. */
    testers: number;
    /** All submissions (any kind). */
    submissions: number;
    /** Sum of approved `payoutAmount` (USDC). */
    totalPaid: number;
  };
};

export function serializeCampaignListPreview(
  c: Campaign,
  opts: {
    companyName: string;
    logoUrl?: string | null;
    testers: number;
    submissions: number;
    totalPaid: number;
  },
): CampaignListPreview {
  return {
    id: c.id,
    title: c.title,
    company: opts.companyName,
    logoUrl: opts.logoUrl ?? undefined,
    status: c.status,
    description: c.description ?? "",
    deviceRequirements: normalizeDeviceRequirements(c.deviceRequirements),
    createdAt: c.createdAt.toISOString(),
    stats: {
      testers: opts.testers,
      submissions: opts.submissions,
      totalPaid: opts.totalPaid,
    },
  };
}

/** `GET /client/campaigns/list` — same card shape as public browse, plus listing/escrow flags; `stats.totalBudget` = funded USDC (`campaign.budget`). */
export type ClientCampaignListPreview = {
  id: string;
  title: string;
  company: string;
  logoUrl?: string;
  status: string;
  description: string;
  deviceRequirements: DeviceRequirementId[];
  createdAt: string;
  listed: boolean;
  escrowPda: string | null;
  stats: {
    testers: number;
    submissions: number;
    /** Funded campaign budget (USDC), same as DB `budget`. */
    totalBudget: number;
  };
};

export function serializeClientCampaignListPreview(
  c: Campaign,
  opts: {
    companyName: string;
    logoUrl?: string | null;
    testers: number;
    submissions: number;
    totalBudget: number;
  },
): ClientCampaignListPreview {
  return {
    id: c.id,
    title: c.title,
    company: opts.companyName,
    logoUrl: opts.logoUrl ?? undefined,
    status: c.status,
    description: c.description ?? "",
    deviceRequirements: normalizeDeviceRequirements(c.deviceRequirements),
    createdAt: c.createdAt.toISOString(),
    listed: c.listed,
    escrowPda: c.escrowPda,
    stats: {
      testers: opts.testers,
      submissions: opts.submissions,
      totalBudget: opts.totalBudget,
    },
  };
}
