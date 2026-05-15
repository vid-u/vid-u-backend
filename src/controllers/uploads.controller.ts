import type { Request, Response } from "express";
import { sendSuccess } from "../utils/api-response.js";
import { createPresignedUpload } from "../services/uploads-presign.service.js";
import type { PresignUploadBodyDto } from "../validation/uploads.schema.js";

export async function postUploadPresign(req: Request, res: Response): Promise<void> {
  const brandUserId = req.dbUser!.id;
  const body = req.body as PresignUploadBodyDto;
  const data = await createPresignedUpload(brandUserId, body);
  sendSuccess(res, data);
}
