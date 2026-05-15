import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validateParams, validateQuery } from "../../middleware/validate.js";
import { listCampaignsQuerySchema } from "../../validation/campaigns-public.schema.js";
import { campaignIdParamsSchema } from "../../validation/index.js";
import * as pub from "../../controllers/campaigns-public.controller.js";

/**
 * Public campaign discovery (`GET /campaigns`, `GET /campaigns/:id`). Mounted at `/campaigns`.
 */
export const creatorCampaignRouter = Router();

creatorCampaignRouter.get("/", validateQuery(listCampaignsQuerySchema), asyncHandler(pub.listActiveCampaigns));
creatorCampaignRouter.get(
  "/:id",
  validateParams(campaignIdParamsSchema),
  asyncHandler(pub.getActiveCampaign),
);
