import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { UPLOAD_MAX_BYTES, UPLOAD_PRESIGN_EXPIRES_SEC } from "../config/uploads-r2.js";
import { AppError, NotFoundError, ValidationError } from "../utils/errors.js";
import type { PresignUploadBodyDto } from "../validation/uploads.schema.js";

const extByContentType: Record<PresignUploadBodyDto["contentType"], string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

let s3Client: S3Client | undefined;

export function r2Configured(): boolean {
  return Boolean(
    env.R2_S3_ENDPOINT &&
      env.R2_BUCKET &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY,
  );
}

export function getS3Client(): S3Client {
  if (!r2Configured()) {
    throw new AppError(
      "Object storage is not configured (R2_S3_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)",
      503,
    );
  }
  s3Client ??= new S3Client({
    region: "auto",
    endpoint: env.R2_S3_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
  return s3Client;
}

function buildObjectKey(userId: string, body: PresignUploadBodyDto): string {
  const ext = extByContentType[body.contentType];
  const id = randomUUID();
  if (body.purpose === "brand_logo") {
    return `users/${userId}/brand-logo/${id}${ext}`;
  }
  const campaignId = body.campaignId;
  if (!campaignId) {
    throw new ValidationError("campaignId is required for campaign_cover");
  }
  return `campaigns/${campaignId}/covers/${id}${ext}`;
}

export type PresignUploadResult = {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string | null;
  method: "PUT";
  expiresIn: number;
  maxBytes: number;
  headers: { "Content-Type": string };
};

export async function createPresignedUpload(
  brandUserId: string,
  body: PresignUploadBodyDto,
): Promise<PresignUploadResult> {
  if (body.purpose === "campaign_cover") {
    const campaignId = body.campaignId;
    if (!campaignId) {
      throw new ValidationError("campaignId is required for campaign_cover");
    }
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, brandUserId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundError("Campaign not found");
  }

  const objectKey = buildObjectKey(brandUserId, body);
  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET!,
    Key: objectKey,
    ContentType: body.contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: UPLOAD_PRESIGN_EXPIRES_SEC,
  });

  const base = env.PUBLIC_OBJECT_BASE_URL?.replace(/\/$/, "");
  const publicUrl = base ? `${base}/${objectKey}` : null;

  return {
    uploadUrl,
    objectKey,
    publicUrl,
    method: "PUT",
    expiresIn: UPLOAD_PRESIGN_EXPIRES_SEC,
    maxBytes: UPLOAD_MAX_BYTES,
    headers: { "Content-Type": body.contentType },
  };
}
