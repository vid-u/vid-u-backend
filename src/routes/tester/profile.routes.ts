import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as profileController from "../../controllers/profile.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { patchTesterProfileBody } from "../../validation/index.js";

/** Core identity only — work preferences and availability use `/work-preferences` and `/availability`. */

/** `GET|PATCH /profile` (tester) — mounted at `/profile`. */
export const testerProfileRouter = Router();

testerProfileRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  asyncHandler(profileController.getTesterProfile),
);

testerProfileRouter.patch(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  validateBody(patchTesterProfileBody),
  asyncHandler(profileController.patchTesterProfile),
);
