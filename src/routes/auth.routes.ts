import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import * as authController from "../controllers/auth.controller.js";
import { emailSendCodeBodySchema, emailVerifyBodySchema } from "../validation/auth.schema.js";

export const authRouter = Router();

authRouter.post(
  "/email/send-code",
  validateBody(emailSendCodeBodySchema),
  asyncHandler(authController.postEmailSendCode),
);
authRouter.post(
  "/email/verify",
  validateBody(emailVerifyBodySchema),
  asyncHandler(authController.postEmailVerify),
);
authRouter.get("/google/start", asyncHandler(authController.getGoogleStart));
authRouter.get("/google/callback", asyncHandler(authController.getGoogleCallback));
authRouter.post("/sign-out", asyncHandler(authController.postSignOut));
