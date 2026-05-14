import { Router } from "express";
import * as healthController from "../controllers/health.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const healthRouter = Router();

healthRouter.get(["/", "/health"], healthController.getLiveness);

healthRouter.get("/health/ready", asyncHandler(healthController.getReady));
