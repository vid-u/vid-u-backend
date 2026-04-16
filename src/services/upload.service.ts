import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { CampaignStatus, UserRole } from "../generated/prisma/enums.js";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import type {
  PresignDownloadInput,
  PresignUploadInput,
} from "../types/upload.types.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors.js";

let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "R2 is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET"
    );
  }
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET
  );
}

const PRESIGN_PUT_SECONDS = 15 * 60;
const PRESIGN_GET_SECONDS = 60 * 60;

const EVIDENCE_CONTENT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "video/mp4",
  "video/webm",
  "text/plain",
] as const;

const AVATAR_LOGO_CONTENT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}

function publicUrlForKey(key: string): string | undefined {
  if (!env.R2_PUBLIC_BASE_URL) return undefined;
  const base = env.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${path}`;
}

export function isPublicAssetKey(key: string): boolean {
  return key.startsWith("avatars/") || key.startsWith("clients/");
}

export async function presignUpload(
  input: PresignUploadInput,
): Promise<{
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  objectKey: string;
  publicUrl?: string;
  expiresInSeconds: number;
}> {
  if (!isR2Configured()) {
    throw new ValidationError(
      "R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET"
    );
  }

  const safe = safeFilename(input.filename);
  const id = randomUUID();
  let objectKey: string;

  if (input.purpose === "avatar") {
    if (!AVATAR_LOGO_CONTENT.includes(input.contentType as (typeof AVATAR_LOGO_CONTENT)[number])) {
      throw new ValidationError("Invalid content type for avatar");
    }
    objectKey = `avatars/${input.userId}/${id}-${safe}`;
  } else if (input.purpose === "client_logo") {
    if (input.role !== UserRole.client) {
      throw new ForbiddenError("Only clients can upload a company logo");
    }
    if (!AVATAR_LOGO_CONTENT.includes(input.contentType as (typeof AVATAR_LOGO_CONTENT)[number])) {
      throw new ValidationError("Invalid content type for client logo");
    }
    objectKey = `clients/${input.userId}/logo/${id}-${safe}`;
  } else {
    if (input.role !== UserRole.tester) {
      throw new ForbiddenError("Only testers can upload submission evidence");
    }
    if (!EVIDENCE_CONTENT.includes(input.contentType as (typeof EVIDENCE_CONTENT)[number])) {
      throw new ValidationError("Invalid content type for evidence");
    }
    const campaignId = input.campaignId;
    if (!campaignId) {
      throw new ValidationError("campaignId is required for evidence uploads");
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw new NotFoundError("Campaign not found");

    if (campaign.status !== CampaignStatus.active || !campaign.escrowPda) {
      throw new ValidationError("Campaign is not accepting submissions");
    }

    if (input.submissionId) {
      const sub = await prisma.submission.findFirst({
        where: {
          id: input.submissionId,
          campaignId,
          testerId: input.userId,
        },
      });
      if (!sub) {
        throw new ForbiddenError("Submission not found or not yours");
      }
      objectKey = `campaigns/${campaignId}/submissions/${input.submissionId}/${id}-${safe}`;
    } else {
      objectKey = `campaigns/${campaignId}/draft/${input.userId}/${id}-${safe}`;
    }
  }

  const bucket = env.R2_BUCKET!;
  const s3 = getR2Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: input.contentType,
  });
  const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_PUT_SECONDS });

  const publicUrl =
    input.purpose === "avatar" || input.purpose === "client_logo"
      ? publicUrlForKey(objectKey)
      : undefined;

  return {
    method: "PUT",
    url,
    headers: {
      "Content-Type": input.contentType,
    },
    objectKey,
    publicUrl,
    expiresInSeconds: PRESIGN_PUT_SECONDS,
  };
}

export async function presignEvidenceDownload(
  input: PresignDownloadInput,
): Promise<{
  method: "GET";
  url: string;
  expiresInSeconds: number;
}> {
  if (!isR2Configured()) {
    throw new ValidationError("R2 is not configured");
  }

  const key = input.objectKey.trim();
  if (key.includes("..") || key.startsWith("/")) {
    throw new ValidationError("Invalid object key");
  }

  if (isPublicAssetKey(key)) {
    throw new ValidationError("Use public URL for avatars and logos — no presigned download needed");
  }

  const subMatch = /^campaigns\/([^/]+)\/submissions\/([^/]+)\/(.+)$/.exec(key);
  const draftMatch = /^campaigns\/([^/]+)\/draft\/([^/]+)\/(.+)$/.exec(key);

  if (subMatch) {
    const [, campaignId, submissionId] = subMatch;
    const sub = await prisma.submission.findFirst({
      where: { id: submissionId, campaignId },
      include: { campaign: true },
    });
    if (!sub) throw new NotFoundError("Object not found");

    const isTester = input.role === UserRole.tester && sub.testerId === input.userId;
    const isClient =
      input.role === UserRole.client && sub.campaign.clientId === input.userId;
    if (!isTester && !isClient) {
      throw new ForbiddenError("You cannot access this file");
    }
  } else if (draftMatch) {
    const [, campaignId, testerId] = draftMatch;
    if (input.role !== UserRole.tester || testerId !== input.userId) {
      throw new ForbiddenError("Draft evidence is only accessible to the uploading tester");
    }
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundError("Campaign not found");
  } else {
    throw new ValidationError("Unsupported object key for download");
  }

  const bucket = env.R2_BUCKET!;
  const s3 = getR2Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_GET_SECONDS });

  return {
    method: "GET",
    url,
    expiresInSeconds: PRESIGN_GET_SECONDS,
  };
}
