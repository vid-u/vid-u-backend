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

/**
 * Top-level `/payment-methods` — **tester** role. Same storage as client (`client_payment_methods` by `userId`);
 * clients use `/client/payment-methods` (client role only).
 */
paymentMethodsRouter.get(
  "/",
  authenticate,
  requireRole(UserRole.tester),
  asyncHandler(paymentMethodController.getPaymentMethods),
);

paymentMethodsRouter.post(
  "/add",
  authenticate,
  requireRole(UserRole.tester),
  validateBody(addPaymentMethodBody),
  asyncHandler(paymentMethodController.postPaymentMethod),
);

paymentMethodsRouter.post(
  "/:id/default",
  authenticate,
  requireRole(UserRole.tester),
  validateParams(paymentMethodIdParams),
  asyncHandler(paymentMethodController.postPaymentMethodDefault),
);

paymentMethodsRouter.delete(
  "/:id",
  authenticate,
  requireRole(UserRole.tester),
  validateParams(paymentMethodIdParams),
  asyncHandler(paymentMethodController.deletePaymentMethod),
);
