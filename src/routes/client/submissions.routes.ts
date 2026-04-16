import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as submissionController from "../../controllers/submission.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  approveSubmissionBody,
  commentBody,
  clientSubmissionParams,
  listClientCampaignSubmissionsQuery,
  patchSubmissionBody,
  rejectSubmissionBody,
} from "../../validation/index.js";

/**
 * Client-only — mounted at `/client/submissions`.
 * `GET /` lists submissions; optional `campaignId` scopes to one campaign.
 * Other routes use `submissionId` only; ownership is enforced in services.
 */
export const clientSubmissionsRouter = Router();

clientSubmissionsRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.client),
  validateQuery(listClientCampaignSubmissionsQuery),
  asyncHandler(submissionController.listClientCampaignSubmissions),
);

clientSubmissionsRouter.get(
  "/:submissionId",
  authenticate,
  requireRole(UserRole.client),
  validateParams(clientSubmissionParams),
  asyncHandler(submissionController.getClientCampaignSubmission),
);

clientSubmissionsRouter.patch(
  "/:submissionId/update",
  authenticate,
  requireRole(UserRole.client),
  validateParams(clientSubmissionParams),
  validateBody(patchSubmissionBody),
  asyncHandler(submissionController.patchSubmission),
);

clientSubmissionsRouter.post(
  "/:submissionId/comments",
  authenticate,
  requireRole(UserRole.client),
  validateParams(clientSubmissionParams),
  validateBody(commentBody),
  asyncHandler(submissionController.postComment),
);

clientSubmissionsRouter.post(
  "/:submissionId/approve",
  authenticate,
  requireRole(UserRole.client),
  validateParams(clientSubmissionParams),
  validateBody(approveSubmissionBody),
  asyncHandler(submissionController.postApprove),
);

clientSubmissionsRouter.post(
  "/:submissionId/reject",
  authenticate,
  requireRole(UserRole.client),
  validateParams(clientSubmissionParams),
  validateBody(rejectSubmissionBody),
  asyncHandler(submissionController.postReject),
);
