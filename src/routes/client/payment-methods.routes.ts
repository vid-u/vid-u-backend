import { Router } from "express";
import { UserRole } from "../../generated/prisma/enums.js";
import * as paymentMethodController from "../../controllers/payment-method.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import {
  addPaymentMethodBody,
  paymentMethodIdParams,
} from "../../validation/index.js";

/** Mounted at `/client/payment-methods` — same handlers as `/payment-methods`, **client** role only. */
export const clientPaymentMethodsRouter = Router();

clientPaymentMethodsRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.client),
  asyncHandler(paymentMethodController.getPaymentMethods),
);

clientPaymentMethodsRouter.post(
  "/add",
  authenticate,
  requireRole(UserRole.client),
  validateBody(addPaymentMethodBody),
  asyncHandler(paymentMethodController.postPaymentMethod),
);

clientPaymentMethodsRouter.post(
  "/:id/default",
  authenticate,
  requireRole(UserRole.client),
  validateParams(paymentMethodIdParams),
  asyncHandler(paymentMethodController.postPaymentMethodDefault),
);

clientPaymentMethodsRouter.delete(
  "/:id",
  authenticate,
  requireRole(UserRole.client),
  validateParams(paymentMethodIdParams),
  asyncHandler(paymentMethodController.deletePaymentMethod),
);
