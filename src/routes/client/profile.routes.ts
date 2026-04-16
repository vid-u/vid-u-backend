import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as profileController from "../../controllers/profile.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { patchClientProfileBody } from "../../validation/index.js";

/** `GET|PATCH /client/profile` — mount at `/profile` on `clientRouter`. */
export const clientProfileRouter = Router();

clientProfileRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.client),
  asyncHandler(profileController.getClientProfile),
);

clientProfileRouter.patch(
  "/",
  authenticate,
  requireRole(UserRole.client),
  validateBody(patchClientProfileBody),
  asyncHandler(profileController.patchClientProfile),
);
