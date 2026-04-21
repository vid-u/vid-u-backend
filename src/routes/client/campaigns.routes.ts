import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as campaignController from "../../controllers/campaign.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  campaignIdParams,
  clientCampaignIdParams,
  closeCampaignBody,
  createCampaignBody,
  fundCampaignBody,
  listActivitiesQuery,
  listClientCampaignsQuery,
  patchCampaignBody,
  topUpCampaignBody,
} from "../../validation/index.js";

/** Client-only — mounted at `/client/campaigns` (list/create and `/:campaignId/activities` before public `GET /campaigns/:id`). */
export const clientCampaignRouter = Router();

clientCampaignRouter.get(
  "/list",
  authenticate,
  requireRole(UserRole.client),
  validateQuery(listClientCampaignsQuery),
  asyncHandler(campaignController.getCampaignsMine),
);

clientCampaignRouter.post(
  "/create",
  authenticate,
  requireRole(UserRole.client),
  validateBody(createCampaignBody),
  asyncHandler(campaignController.postCampaign),
);

clientCampaignRouter.patch(
  "/:id/update",
  authenticate,
  requireRole(UserRole.client),
  validateParams(campaignIdParams),
  validateBody(patchCampaignBody),
  asyncHandler(campaignController.patchCampaignById),
);

clientCampaignRouter.post(
  "/:id/fund",
  authenticate,
  requireRole(UserRole.client),
  validateParams(campaignIdParams),
  validateBody(fundCampaignBody),
  asyncHandler(campaignController.postFundCampaign),
);

clientCampaignRouter.get(
  "/:id/sync-fund",
  authenticate,
  requireRole(UserRole.client),
  validateParams(campaignIdParams),
  asyncHandler(campaignController.getCampaignFundingSync),
);

clientCampaignRouter.post(
  "/:id/sync-fund",
  authenticate,
  requireRole(UserRole.client),
  validateParams(campaignIdParams),
  asyncHandler(campaignController.postCampaignFundingSync),
);

clientCampaignRouter.post(
  "/:id/top-up",
  authenticate,
  requireRole(UserRole.client),
  validateParams(campaignIdParams),
  validateBody(topUpCampaignBody),
  asyncHandler(campaignController.postTopUpCampaign),
);

clientCampaignRouter.post(
  "/:id/close",
  authenticate,
  requireRole(UserRole.client),
  validateParams(campaignIdParams),
  validateBody(closeCampaignBody),
  asyncHandler(campaignController.postCloseCampaign),
);

clientCampaignRouter.get(
  "/:campaignId/activities",
  authenticate,
  requireRole(UserRole.client),
  validateParams(clientCampaignIdParams),
  validateQuery(listActivitiesQuery),
  asyncHandler(campaignController.getCampaignActivities),
);
