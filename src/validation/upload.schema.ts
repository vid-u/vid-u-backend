import { z } from "zod";
import { uuidString } from "./common.js";

const evidenceContentType = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "video/mp4",
  "video/webm",
  "text/plain",
]);

const avatarLogoContentType = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const presignUploadBody = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("avatar"),
    filename: z.string().min(1).max(255),
    contentType: avatarLogoContentType,
  }),
  z.object({
    purpose: z.literal("client_logo"),
    filename: z.string().min(1).max(255),
    contentType: avatarLogoContentType,
  }),
  z.object({
    purpose: z.literal("evidence"),
    campaignId: uuidString,
    submissionId: uuidString.optional(),
    filename: z.string().min(1).max(255),
    contentType: evidenceContentType,
  }),
]);

export const presignDownloadBody = z.object({
  objectKey: z.string().min(3).max(2048),
});

export type PresignUploadDto = z.infer<typeof presignUploadBody>;
export type PresignDownloadDto = z.infer<typeof presignDownloadBody>;
