import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validateParams } from "../../middleware/validate.js";
import { mePlatformPathParamsSchema } from "../../validation/index.js";
import * as me from "../../controllers/me.controller.js";

/**
 * Mounted at `/me/platforms` from `me.routes.ts` (auth + creator guard applied by parent).
 */
export const meCreatorPlatformsRouter = Router({ mergeParams: true });

meCreatorPlatformsRouter.get("/", asyncHandler(me.getMePlatforms));
meCreatorPlatformsRouter.delete(
  "/:platform",
  validateParams(mePlatformPathParamsSchema),
  asyncHandler(me.deleteMePlatform),
);
