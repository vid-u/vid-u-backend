import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { syncBody } from "../validation/index.js";

export const authRouter = Router();

authRouter.post(
  "/sync",
  authenticate,
  validateBody(syncBody),
  asyncHandler(authController.postSync)
);

authRouter.get("/me", authenticate, (req, res) => {
  res.json({
    success: true,
    message: "ok",
    data: {
      authUser: req.authUser ?? null,
    },
  });
});
