import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { submissionPreviewRateLimiter } from "../../middleware/submission-preview-rate-limit.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { campaignIdParamsSchema, submissionPreviewBodySchema } from "../../validation/index.js";
import * as subs from "../../controllers/submissions.controller.js";

/**
 * Creator submission preview & confirm. Mounted at `/campaigns`.
 */
export const creatorSubmissionsRouter = Router();

creatorSubmissionsRouter.post(
  "/:id/submissions/preview",
  submissionPreviewRateLimiter,
  validateParams(campaignIdParamsSchema),
  validateBody(submissionPreviewBodySchema),
  asyncHandler(subs.postSubmissionPreview),
);
creatorSubmissionsRouter.post(
  "/:id/submissions",
  validateParams(campaignIdParamsSchema),
  validateBody(submissionPreviewBodySchema),
  asyncHandler(subs.postSubmissionConfirm),
);
