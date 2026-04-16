import { Router } from "express";
import * as waitlistController from "../controllers/waitlist.controller.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { waitlistBody } from "../validation/index.js";

export const waitlistRouter = Router();

waitlistRouter.get("/", asyncHandler(waitlistController.getWaitlist));

waitlistRouter.post(
  "/",
  validateBody(waitlistBody),
  asyncHandler(waitlistController.postWaitlist)
);
