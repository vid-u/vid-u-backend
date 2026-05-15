import { z } from "zod";

const social = z.union([z.string().max(500), z.literal(""), z.null()]).optional();

export const putMeBrandProfileBodySchema = z
  .object({
    brandName: z.string().min(1).max(200).optional(),
    website: social,
    instagram: social,
    facebook: social,
    tiktok: social,
    /** Set after `POST /uploads/presign` with purpose `brand_logo` (same user). */
    logoObjectKey: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

export type PutMeBrandProfileBodyDto = z.infer<typeof putMeBrandProfileBodySchema>;

export const putMeCreatorProfileBodySchema = z.object({}).strict();

export type PutMeCreatorProfileBodyDto = z.infer<typeof putMeCreatorProfileBodySchema>;
