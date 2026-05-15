import { z } from "zod";

/** Query string for public `GET /campaigns` (marketing + creator explore). */
export const listCampaignsQuerySchema = z
  .object({
    /** `all` = non-draft campaigns (`active`, `paused`, `ended`). Omit or `all` for the UI default “All campaigns”. */
    status: z.enum(["all", "active", "paused", "ended"]).optional().default("all"),
    /** When set, only campaigns whose `platforms` JSON array includes this platform. */
    platform: z.enum(["tiktok", "facebook"]).optional(),
    /** `newest` = `updatedAt` desc; `highest_rate` = `ratePer1k` desc then `updatedAt` desc. */
    sort: z.enum(["newest", "highest_rate"]).optional().default("newest"),
  })
  .strict();

export type ListCampaignsQueryDto = z.infer<typeof listCampaignsQuerySchema>;
