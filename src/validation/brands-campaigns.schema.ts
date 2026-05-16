import { z } from "zod";
import { MIN_BRAND_RATE_PER_1K, MIN_PUBLISH_PHP } from "../config/campaign-limits.js";

const optionalUrlArray = z.array(z.string().url()).optional();
const optionalUrlArrayOrNull = z.array(z.string().url()).nullable().optional();

export const createBrandCampaignBodySchema = z
  .object({
    title: z.string().min(1),
    description: z.string(),
    ratePer1k: z.number().min(MIN_BRAND_RATE_PER_1K),
    plannedGrossBudget: z.number().min(MIN_PUBLISH_PHP),
    platforms: z.array(z.enum(["tiktok", "facebook"])).min(1),
    rules: z.array(z.string()).min(1),
    referenceLinks: optionalUrlArray,
    assetUrls: optionalUrlArray,
    coverImageObjectKey: z.string().min(1).optional(),
  })
  .strict();

export type CreateBrandCampaignBodyDto = z.infer<typeof createBrandCampaignBodySchema>;

export const patchBrandCampaignBodySchema = z
  .object({
    status: z.enum(["draft", "active", "paused", "ended"]).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    platforms: z.array(z.enum(["tiktok", "facebook"])).min(1).optional(),
    ratePer1k: z.number().min(MIN_BRAND_RATE_PER_1K).optional(),
    plannedGrossBudget: z.number().min(0).optional(),
    rules: z.array(z.string()).min(1).optional(),
    referenceLinks: optionalUrlArrayOrNull,
    assetUrls: optionalUrlArrayOrNull,
    coverImageObjectKey: z.union([z.string().min(1), z.null()]).optional(),
  })
  .strict();

export type PatchBrandCampaignBodyDto = z.infer<typeof patchBrandCampaignBodySchema>;

export const brandCheckoutSessionBodySchema = z
  .object({
    grossAmount: z.number().positive(),
    intent: z.enum(["add_funds", "initial_publish"]).optional(),
  })
  .strict();

export type BrandCheckoutSessionBodyDto = z.infer<typeof brandCheckoutSessionBodySchema>;

export const brandRejectSubmissionBodySchema = z
  .object({
    reason: z.string().min(1),
  })
  .strict();

export type BrandRejectSubmissionBodyDto = z.infer<typeof brandRejectSubmissionBodySchema>;

export const brandCheckoutSyncParamsSchema = z
  .object({
    id: z.string().uuid(),
    externalId: z.string().min(6).startsWith("fund_"),
  })
  .strict();

export type BrandCheckoutSyncParamsDto = z.infer<typeof brandCheckoutSyncParamsSchema>;
