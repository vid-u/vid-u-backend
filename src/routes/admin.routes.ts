import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAdminBasicAuth } from "../middleware/admin-basic-auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  adminCampaignIdParamsSchema,
  adminLedgerAdjustBodySchema,
  adminSubmissionIdParamsSchema,
} from "../validation/index.js";
import * as admin from "../controllers/admin.controller.js";

export const adminRouter = Router();
adminRouter.use(requireAdminBasicAuth);

adminRouter.post(
  "/reconcile-campaign/:id",
  validateParams(adminCampaignIdParamsSchema),
  asyncHandler(admin.postReconcileCampaign),
);
adminRouter.post(
  "/campaigns/:id/ledger/adjust",
  validateParams(adminCampaignIdParamsSchema),
  validateBody(adminLedgerAdjustBodySchema),
  asyncHandler(admin.postLedgerAdjust),
);
adminRouter.post(
  "/submissions/:id/force-reject",
  validateParams(adminSubmissionIdParamsSchema),
  asyncHandler(admin.postForceRejectSubmission),
);
adminRouter.get(
  "/audit/campaign/:id",
  validateParams(adminCampaignIdParamsSchema),
  asyncHandler(admin.getAuditCampaign),
);
