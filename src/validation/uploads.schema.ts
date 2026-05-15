import { z } from "zod";

export const presignUploadBodySchema = z
  .object({
    purpose: z.enum(["brand_logo", "campaign_cover"]),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    campaignId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.purpose === "campaign_cover" && val.campaignId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "campaignId is required when purpose is campaign_cover",
        path: ["campaignId"],
      });
    }
    if (val.purpose === "brand_logo" && val.campaignId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "campaignId must be omitted when purpose is brand_logo",
        path: ["campaignId"],
      });
    }
  });

export type PresignUploadBodyDto = z.infer<typeof presignUploadBodySchema>;
