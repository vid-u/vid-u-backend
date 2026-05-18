import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import {
  brandRejectSubmissionBodySchema,
  brandRejectSubmissionParamsSchema,
  campaignIdParamsSchema,
  listBrandCampaignSubmissionsQuerySchema,
  listBrandRecentSubmissionsQuerySchema,
} from "../../validation/index.js";
import * as brands from "../../controllers/brands-campaigns.controller.js";
import * as subs from "../../controllers/submissions.controller.js";

/**
 * Brand-side submission review. Mounted under `/brands`.
 */
export const brandSubmissionsRouter = Router();

brandSubmissionsRouter.get(
  "/submissions",
  validateQuery(listBrandRecentSubmissionsQuerySchema),
  asyncHandler(subs.listBrandRecentSubmissions),
);
brandSubmissionsRouter.get(
  "/campaigns/:id/submissions",
  validateParams(campaignIdParamsSchema),
  validateQuery(listBrandCampaignSubmissionsQuerySchema),
  asyncHandler(subs.listCampaignSubmissions),
);
brandSubmissionsRouter.post(
  "/campaigns/:id/submissions/:submissionId/reject",
  validateParams(brandRejectSubmissionParamsSchema),
  validateBody(brandRejectSubmissionBodySchema),
  asyncHandler(brands.postBrandRejectSubmission),
);
brandSubmissionsRouter.post(
  "/campaigns/:id/submissions/:submissionId/restore",
  validateParams(brandRejectSubmissionParamsSchema),
  asyncHandler(brands.postBrandRestoreSubmission),
);
