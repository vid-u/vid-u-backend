import { Router } from "express";
import * as uploadController from "../controllers/upload.controller.js";
import { authenticate } from "../middleware/auth.js";
import { loadDbUser } from "../middleware/loadDbUser.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { presignDownloadBody, presignUploadBody } from "../validation/index.js";

/** Presigned R2 uploads — testers and clients. */
export const uploadRouter = Router();

uploadRouter.post(
  "/presign",
  authenticate,
  loadDbUser,
  validateBody(presignUploadBody),
  asyncHandler(uploadController.postPresign),
);

uploadRouter.post(
  "/presign-download",
  authenticate,
  loadDbUser,
  validateBody(presignDownloadBody),
  asyncHandler(uploadController.postPresignDownload),
);
