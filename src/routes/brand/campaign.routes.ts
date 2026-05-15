import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import {
  brandCheckoutSessionBodySchema,
  campaignIdParamsSchema,
  createBrandCampaignBodySchema,
  patchBrandCampaignBodySchema,
} from "../../validation/index.js";
import * as brands from "../../controllers/brands-campaigns.controller.js";

/**
 * Brand campaign lifecycle & funding. Mounted under `/brands` (paths include `/campaigns`).
 */
export const brandCampaignRouter = Router();

brandCampaignRouter.get("/campaigns", asyncHandler(brands.listBrandCampaigns));
brandCampaignRouter.post(
  "/campaigns",
  validateBody(createBrandCampaignBodySchema),
  asyncHandler(brands.createBrandCampaign),
);
brandCampaignRouter.get("/campaigns/:id", validateParams(campaignIdParamsSchema), asyncHandler(brands.getBrandCampaign));
brandCampaignRouter.patch(
  "/campaigns/:id",
  validateParams(campaignIdParamsSchema),
  validateBody(patchBrandCampaignBodySchema),
  asyncHandler(brands.patchBrandCampaign),
);
brandCampaignRouter.post(
  "/campaigns/:id/checkout",
  validateParams(campaignIdParamsSchema),
  validateBody(brandCheckoutSessionBodySchema),
  asyncHandler(brands.postCheckoutSession),
);
brandCampaignRouter.post(
  "/campaigns/:id/release-payout",
  validateParams(campaignIdParamsSchema),
  asyncHandler(brands.postPayoutReleases),
);
brandCampaignRouter.post(
  "/campaigns/:id/refund",
  validateParams(campaignIdParamsSchema),
  asyncHandler(brands.postCampaignRefund),
);
