import { z } from "zod";

export const putMeRoleBodySchema = z
  .object({
    role: z.enum(["brand", "creator"]),
  })
  .strict();

export type PutMeRoleBodyDto = z.infer<typeof putMeRoleBodySchema>;

/** Partial update for `User.name` and `User.avatarUrl` (display name + photo). */
export const patchMeBodySchema = z
  .object({
    name: z.union([z.string().min(1).max(200), z.null()]).optional(),
    avatarUrl: z.union([z.string().url().max(2048), z.null()]).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.avatarUrl !== undefined, {
    message: "At least one field is required",
  });

export type PatchMeBodyDto = z.infer<typeof patchMeBodySchema>;

export const mePlatformPathParamsSchema = z
  .object({
    platform: z.enum(["tiktok", "facebook"]),
  })
  .strict();

export type MePlatformPathParamsDto = z.infer<typeof mePlatformPathParamsSchema>;

export const analyticsGranularitySchema = z.enum(["monthly", "yearly"]);

export const getMeAnalyticsQuerySchema = z
  .object({
    granularity: analyticsGranularitySchema,
  })
  .strict();

export type GetMeAnalyticsQueryDto = z.infer<typeof getMeAnalyticsQuerySchema>;
export type AnalyticsGranularity = z.infer<typeof analyticsGranularitySchema>;
