import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as profileController from "../../controllers/profile.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { patchAvailabilityBody } from "../../validation/index.js";

/** `GET|PATCH /availability` (tester) — mounted at `/availability`. */
export const testerAvailabilityRouter = Router();

testerAvailabilityRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  asyncHandler(profileController.getTesterAvailability),
);

testerAvailabilityRouter.patch(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  validateBody(patchAvailabilityBody),
  asyncHandler(profileController.patchTesterAvailability),
);
