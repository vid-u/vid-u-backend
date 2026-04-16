import { Router } from "express";
import * as jobsController from "../controllers/jobs.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const jobsRouter = Router();

jobsRouter.post(
  "/check-expired",
  asyncHandler(jobsController.postCheckExpired)
);
