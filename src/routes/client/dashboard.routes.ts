import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as dashboardController from "../../controllers/dashboard.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

/** `GET /client/dashboard` */
export const clientDashboardRouter = Router();

clientDashboardRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.client),
  asyncHandler(dashboardController.getClientDashboard),
);
