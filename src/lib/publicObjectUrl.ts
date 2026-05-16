import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";
import { getS3Client, r2Configured } from "../services/uploads-presign.service.js";

const SIGNED_OBJECT_URL_EXPIRES_SEC = 3600;

/** Builds a public URL for an R2 object key when `PUBLIC_OBJECT_BASE_URL` is set. */
export function publicUrlFromObjectKey(objectKey: string | null | undefined): string | null {
  if (!objectKey) return null;
  const base = env.PUBLIC_OBJECT_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/${objectKey}` : null;
}

/** Public CDN URL when configured; otherwise a short-lived signed GET URL for private R2. */
export async function resolveObjectDisplayUrl(
  objectKey: string | null | undefined,
): Promise<string | null> {
  if (!objectKey?.trim()) return null;
  const publicUrl = publicUrlFromObjectKey(objectKey);
  if (publicUrl) return publicUrl;
  if (!r2Configured() || !env.R2_BUCKET) return null;
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: objectKey });
  return getSignedUrl(client, command, { expiresIn: SIGNED_OBJECT_URL_EXPIRES_SEC });
}
