import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireViduBrand } from "../../middleware/role-access.js";
import { validateBody } from "../../middleware/validate.js";
import { presignUploadBodySchema } from "../../validation/uploads.schema.js";
import * as uploads from "../../controllers/uploads.controller.js";

export const uploadsRouter = Router();

uploadsRouter.use(requireAuth, requireViduBrand);

uploadsRouter.post(
  "/presign",
  validateBody(presignUploadBodySchema),
  asyncHandler(uploads.postUploadPresign),
);
