import { z } from "zod";

/** `GET /campaigns/:id/activities`, `GET /client/campaigns/:campaignId/activities` */
export const listActivitiesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type ListActivitiesQueryDto = z.infer<typeof listActivitiesQuery>;
