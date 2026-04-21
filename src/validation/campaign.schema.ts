import { z } from "zod";
import { deviceRequirementIdSchema } from "../lib/device-requirements.js";
import { uuidString } from "./common.js";

/** `GET /campaigns` — public browse (pagination, filters, sort). */
export const listPublicCampaignsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Filter by lifecycle; `all` = active, paused, ended (all must be listed + escrow). */
  status: z.enum(["all", "active", "paused", "ended"]).default("all"),
  /** Comma-separated device slugs (`iphone`, `mac`, …). */
  devices: z
    .string()
    .optional()
    .transform((s) =>
      s?.trim() ? s.split(",").map((x) => x.trim()).filter(Boolean) : [],
    )
    .pipe(z.array(deviceRequirementIdSchema)),
  /** Case-insensitive search on title, description, company name. */
  q: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? undefined : val),
    z.string().trim().max(200).optional(),
  ),
  /** `newest` = `createdAt` desc; `most_pay` = `budget` desc (USDC funded). */
  sort: z.enum(["newest", "most_pay"]).default("newest"),
});

export type ListPublicCampaignsQueryDto = z.infer<typeof listPublicCampaignsQuery>;

const severityRewardTier = z.object({
  min: z.union([z.number(), z.string()]),
  max: z.union([z.number(), z.string()]),
});

export const severityRewardsJson = z
  .object({
    critical: severityRewardTier.optional(),
    high: severityRewardTier.optional(),
    medium: severityRewardTier.optional(),
    mild: severityRewardTier.optional(),
  })
  .optional();

const downloadLinksJson = z.record(z.string()).optional();

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const isoDateRequired = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const optionalEndDate = z.preprocess(
  (val) => (val === "" || val === undefined || val === null ? undefined : val),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
);

/** Empty string or a valid http(s) URL (unused platforms may be left blank). */
const createCampaignOptionalAppLink = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? "" : String(v).trim()),
  z.union([z.literal(""), z.string().url().max(2000)]),
);

/** At least one non-empty platform link required; others optional. */
export const createCampaignDownloadLinks = z
  .object({
    ios: createCampaignOptionalAppLink,
    android: createCampaignOptionalAppLink,
    web: createCampaignOptionalAppLink,
    windows: createCampaignOptionalAppLink,
    mac: createCampaignOptionalAppLink,
    cli: createCampaignOptionalAppLink,
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasAny = Object.values(data).some((v) => v !== "");
    if (!hasAny) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one application link is required",
        path: ["ios"],
      });
    }
  });

const createSeverityRewardsTier = z
  .object({
    min: z.coerce.number().finite(),
    max: z.coerce.number().finite(),
  })
  .refine((t) => t.min >= 0 && t.min <= t.max, {
    path: ["max"],
    message: "Each severity tier must have 0 ≤ min ≤ max",
  });

/** Interior overlap of closed USDC intervals (sharing only an endpoint is allowed). */
function bountyIntervalsOverlapInterior(
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): boolean {
  return Math.max(aLo, bLo) < Math.min(aHi, bHi);
}

function severityLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export const createCampaignSeverityRewards = z
  .object({
    mild: createSeverityRewardsTier,
    medium: createSeverityRewardsTier,
    high: createSeverityRewardsTier,
    critical: createSeverityRewardsTier,
  })
  .superRefine((sr, ctx) => {
    const tiers = [
      { key: "mild" as const, ...sr.mild },
      { key: "medium" as const, ...sr.medium },
      { key: "high" as const, ...sr.high },
      { key: "critical" as const, ...sr.critical },
    ];
    for (let i = 0; i < tiers.length; i++) {
      for (let j = i + 1; j < tiers.length; j++) {
        const a = tiers[i];
        const b = tiers[j];
        if (bountyIntervalsOverlapInterior(a.min, a.max, b.min, b.max)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${severityLabel(a.key)} (${a.min}–${a.max} USDC) overlaps ${severityLabel(b.key)} (${b.min}–${b.max} USDC); bounty ranges must not overlap`,
            path: [a.key, "min"],
          });
        }
      }
    }
  });

/**
 * `POST /client/campaigns/create` — strict body.
 * Disclosure and reward eligibility are applied server-side (BugHyve standard); do not send them here.
 */
export const createCampaignBody = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(20000),
    /** In-scope / test scope (UI: testScope) */
    scope: z.string().min(1).max(20000),
    outOfScope: z.string().min(1).max(20000),
    /** Optional test-case doc / file link only. */
    inScopeTestCaseUrl: z.preprocess(
      (v) => (v === "" || v === undefined || v === null ? undefined : v),
      z.string().trim().url().max(2000).optional(),
    ),
    downloadLinks: createCampaignDownloadLinks,
    startDate: isoDateRequired,
    endDate: optionalEndDate,
    isApproved: z.boolean().optional(),
    deviceRequirements: z.array(deviceRequirementIdSchema).min(1),
    visibility: z.enum(["private", "public", "restricted"]).default("public"),
    reviewWindowDays: z.number().int().min(1).max(14).default(7),
    severityRewards: createCampaignSeverityRewards,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.endDate) {
      const s = new Date(`${data.startDate}T12:00:00.000Z`).getTime();
      const e = new Date(`${data.endDate}T12:00:00.000Z`).getTime();
      if (e <= s) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "endDate must be after startDate",
          path: ["endDate"],
        });
      }
    }
  });

export const patchCampaignBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(20000).optional(),
    scope: z.string().max(20000).optional(),
    outOfScope: z.string().max(20000).optional(),
    inScopeTestCaseUrl: z.string().max(2000).optional(),
    disclosureGuidelines: z.string().max(20000).optional(),
    rewardEligibility: z.string().max(20000).optional(),
    downloadLinks: downloadLinksJson,
    startDate: isoDateString,
    endDate: isoDateString,
    isApproved: z.boolean().optional(),
    deviceRequirements: z.array(deviceRequirementIdSchema).optional(),
    visibility: z.enum(["private", "public", "restricted"]).optional(),
    listed: z.boolean().optional(),
    reviewWindowDays: z.number().int().min(1).max(365).optional(),
    severityRewards: severityRewardsJson,
    status: z.enum(["draft", "active", "paused", "ended"]).optional(),
  })
  .strict();

export const campaignIdParams = z.object({
  id: uuidString,
});

export const fundCampaignBody = z.object({
  initializeTxSignature: z.string().min(1),
  fundTxSignature: z.string().min(1),
  fundedUsdc: z.union([z.number(), z.string()]),
});

export const topUpCampaignBody = z.object({
  txSignature: z.string().min(1),
  amountUsdc: z.union([z.number(), z.string()]),
});

export const closeCampaignBody = z.object({
  closeTxSignature: z.string().min(1),
});

export const listCampaignsQuery = z.object({
  mine: z.enum(["true", "false"]).optional(),
});

/** `GET /client/campaigns/list` — paginated list-card previews for the authenticated client (narrow payload, aligned with public `/campaigns`). */
export const listClientCampaignsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type ListClientCampaignsQueryDto = z.infer<typeof listClientCampaignsQuery>;

export type CreateCampaignDto = z.infer<typeof createCampaignBody>;
export type PatchCampaignDto = z.infer<typeof patchCampaignBody>;
export type FundCampaignDto = z.infer<typeof fundCampaignBody>;
export type TopUpCampaignDto = z.infer<typeof topUpCampaignBody>;
export type CloseCampaignDto = z.infer<typeof closeCampaignBody>;
