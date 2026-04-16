import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as profileController from "../../controllers/profile.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { patchWorkPreferencesBody } from "../../validation/index.js";

/** `GET|PATCH /work-preferences` (tester) — mounted at `/work-preferences`. */
export const testerWorkPreferencesRouter = Router();

testerWorkPreferencesRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  asyncHandler(profileController.getTesterWorkPreferences),
);

testerWorkPreferencesRouter.patch(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  validateBody(patchWorkPreferencesBody),
  asyncHandler(profileController.patchTesterWorkPreferences),
);
