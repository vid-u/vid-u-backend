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
  commentBody,
  createSubmissionBody,
  listTesterSubmissionsQuery,
  patchTesterSubmissionEvidenceBody,
  submissionIdParams,
} from "../../validation/index.js";

/**
 * Tester-only — mounted at `/submissions`.
 * Register `POST /:id/comments` before `GET /:id` so static segments are not captured as ids.
 */
export const testerSubmissionsRouter = Router();

testerSubmissionsRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  validateQuery(listTesterSubmissionsQuery),
  asyncHandler(submissionController.listTesterSubmissions),
);

testerSubmissionsRouter.post(
  "/create",
  authenticate,
  requireRole(UserRole.tester),
  validateBody(createSubmissionBody),
  asyncHandler(submissionController.postSubmission),
);

testerSubmissionsRouter.patch(
  "/:id/evidence",
  authenticate,
  requireRole(UserRole.tester),
  validateParams(submissionIdParams),
  validateBody(patchTesterSubmissionEvidenceBody),
  asyncHandler(submissionController.patchTesterSubmissionEvidence),
);

testerSubmissionsRouter.post(
  "/:id/comments",
  authenticate,
  requireRole(UserRole.tester),
  validateParams(submissionIdParams),
  validateBody(commentBody),
  asyncHandler(submissionController.postComment),
);

testerSubmissionsRouter.get(
  "/:id",
  authenticate,
  requireRole(UserRole.tester),
  validateParams(submissionIdParams),
  asyncHandler(submissionController.getTesterSubmission),
);
