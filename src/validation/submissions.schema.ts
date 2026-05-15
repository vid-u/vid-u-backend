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

export const listMeSubmissionsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(["pending", "paying", "paid", "payout_failed", "rejected"]).optional(),
  })
  .strict();

export type ListMeSubmissionsQueryDto = z.infer<typeof listMeSubmissionsQuerySchema>;
