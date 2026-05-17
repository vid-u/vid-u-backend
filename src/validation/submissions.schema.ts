import { z } from "zod";

/** Path param `id` = campaign UUID (creator + brand campaign routes). */
export const campaignIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export type CampaignIdParamsDto = z.infer<typeof campaignIdParamsSchema>;

export const brandRejectSubmissionParamsSchema = z
  .object({
    id: z.string().uuid(),
    submissionId: z.string().uuid(),
  })
  .strict();

export type BrandRejectSubmissionParamsDto = z.infer<typeof brandRejectSubmissionParamsSchema>;

export const submissionPreviewBodySchema = z
  .object({
    url: z.string().url(),
    platform: z.enum(["tiktok", "facebook"]),
  })
  .strict();

export type SubmissionPreviewBodyDto = z.infer<typeof submissionPreviewBodySchema>;

export const listBrandCampaignSubmissionsQuerySchema = z
  .object({
    status: z.enum(["pending", "paying", "paid", "payout_failed", "rejected"]).optional(),
  })
  .strict();

export type ListBrandCampaignSubmissionsQueryDto = z.infer<typeof listBrandCampaignSubmissionsQuerySchema>;

/** Brand dashboard inbox — submissions across all campaigns owned by the brand. */
export const listBrandRecentSubmissionsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
    status: z.enum(["pending", "paying", "paid", "payout_failed", "rejected"]).optional(),
  })
  .strict();

export type ListBrandRecentSubmissionsQueryDto = z.infer<typeof listBrandRecentSubmissionsQuerySchema>;

/** UI tabs: `pending` includes in-flight `paying`; `rejected` includes `payout_failed`. */
export const listMeSubmissionsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(["pending", "paid", "rejected"]).optional(),
    /** Dashboard inbox: pending, paying, rejected, payout_failed (excludes paid). */
    scope: z.enum(["recent"]).optional(),
  })
  .strict();

export type ListMeSubmissionsQueryDto = z.infer<typeof listMeSubmissionsQuerySchema>;
