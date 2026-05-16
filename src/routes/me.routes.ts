import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireAnyRole } from "../middleware/auth.js";
import { requireViduBrand, requireViduCreator } from "../middleware/role-access.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  listMeSubmissionsQuerySchema,
  patchMeBodySchema,
  patchPaymentMethodBodySchema,
  paymentMethodIdParamsSchema,
  postPaymentMethodBodySchema,
  getMeAnalyticsQuerySchema,
  putMeRoleBodySchema,
} from "../validation/index.js";
import * as me from "../controllers/me.controller.js";
import * as meProfile from "../controllers/me-profile.controller.js";
import * as paymentMethods from "../controllers/payment-methods.controller.js";
import * as subs from "../controllers/submissions.controller.js";
import { meCreatorPlatformsRouter } from "./creator/me-platforms.routes.js";

export const meRouter = Router();

meRouter.get("/", requireAuth, asyncHandler(me.getMe));
meRouter.patch("/", requireAuth, validateBody(patchMeBodySchema), asyncHandler(me.patchMe));
meRouter.put(
  "/role",
  requireAuth,
  validateBody(putMeRoleBodySchema),
  asyncHandler(me.putMeRole),
);
meRouter.post(
  "/onboarding/complete",
  requireAuth,
  requireAnyRole(),
  asyncHandler(me.postMeOnboardingComplete),
);

meRouter.get("/profile", requireAuth, requireAnyRole(), asyncHandler(meProfile.getMeProfile));
meRouter.put("/profile", requireAuth, requireAnyRole(), asyncHandler(meProfile.putMeProfile));
meRouter.get(
  "/analytics",
  requireAuth,
  requireAnyRole(),
  validateQuery(getMeAnalyticsQuerySchema),
  asyncHandler(meProfile.getMeAnalytics),
);
meRouter.get("/dashboard", requireAuth, requireViduBrand, asyncHandler(meProfile.getMeDashboard));
meRouter.get(
  "/submissions",
  requireAuth,
  requireViduCreator,
  validateQuery(listMeSubmissionsQuerySchema),
  asyncHandler(subs.listMeSubmissions),
);

meRouter.use("/platforms", requireAuth, requireViduCreator, meCreatorPlatformsRouter);

meRouter.get("/payment-methods", requireAuth, requireAnyRole(), asyncHandler(paymentMethods.getPaymentMethods));
meRouter.post(
  "/payment-methods",
  requireAuth,
  requireAnyRole(),
  validateBody(postPaymentMethodBodySchema),
  asyncHandler(paymentMethods.postPaymentMethod),
);
meRouter.patch(
  "/payment-methods/:id",
  requireAuth,
  requireAnyRole(),
  validateParams(paymentMethodIdParamsSchema),
  validateBody(patchPaymentMethodBodySchema),
  asyncHandler(paymentMethods.patchPaymentMethod),
);
meRouter.delete(
  "/payment-methods/:id",
  requireAuth,
  requireAnyRole(),
  validateParams(paymentMethodIdParamsSchema),
  asyncHandler(paymentMethods.deletePaymentMethod),
);
