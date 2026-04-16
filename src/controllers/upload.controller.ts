import type { Request, Response } from "express";
import type { PresignDownloadDto, PresignUploadDto } from "../validation/upload.schema.js";
import * as uploadService from "../services/upload.service.js";
import { sendSuccess } from "../utils/api-response.js";

export async function postPresign(req: Request, res: Response): Promise<void> {
  const u = req.dbUser!;
  const body = req.body as PresignUploadDto;

  const result = await uploadService.presignUpload({
    userId: u.id,
    role: u.role,
    ...body,
  });

  sendSuccess(res, result, "Presigned upload URL");
}

export async function postPresignDownload(req: Request, res: Response): Promise<void> {
  const u = req.dbUser!;
  const body = req.body as PresignDownloadDto;
  const result = await uploadService.presignEvidenceDownload({
    userId: u.id,
    role: u.role,
    objectKey: body.objectKey,
  });
  sendSuccess(res, result, "Presigned download URL");
}
