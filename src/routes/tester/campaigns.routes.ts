import { Router } from "express";
import * as campaignController from "../../controllers/campaign.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { loadDbUser } from "../../middleware/loadDbUser.js";
import { validateParams, validateQuery } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  campaignIdParams,
  listActivitiesQuery,
  listPublicCampaignsQuery,
} from "../../validation/index.js";

/**
 * Mounted at `/campaigns`.
 * Order: static `GET /` first; `/:id/activities` before `/:id` (more specific paths first).
 */
export const campaignsRouter = Router();

campaignsRouter.get(
  "/",
  validateQuery(listPublicCampaignsQuery),
  asyncHandler(campaignController.getCampaignsPublic),
);

campaignsRouter.get(
  "/:id/activities",
  authenticate,
  loadDbUser,
  validateParams(campaignIdParams),
  validateQuery(listActivitiesQuery),
  asyncHandler(campaignController.getCampaignActivities),
);

campaignsRouter.get(
  "/:id",
  authenticate,
  loadDbUser,
  validateParams(campaignIdParams),
  asyncHandler(campaignController.getCampaignById),
);
