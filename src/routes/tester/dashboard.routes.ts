import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as dashboardController from "../../controllers/dashboard.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/** `GET /dashboard` (tester) — mounted at `/dashboard`. */
export const testerDashboardRouter = Router();

testerDashboardRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  asyncHandler(dashboardController.getTesterDashboard),
);
