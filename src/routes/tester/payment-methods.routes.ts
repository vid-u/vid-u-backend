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

export const paymentMethodsRouter = Router();

/** Same handlers as `/client/payment-methods` — clients only (`clientPaymentMethod` rows). */
paymentMethodsRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.client),
  asyncHandler(paymentMethodController.getPaymentMethods),
);

paymentMethodsRouter.post(
  "/add",
  authenticate,
  requireRole(UserRole.client),
  validateBody(addPaymentMethodBody),
  asyncHandler(paymentMethodController.postPaymentMethod),
);

paymentMethodsRouter.delete(
  "/:id",
  authenticate,
  requireRole(UserRole.client),
  validateParams(paymentMethodIdParams),
  asyncHandler(paymentMethodController.deletePaymentMethod),
);
