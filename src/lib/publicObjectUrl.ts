import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";
import { getS3Client, r2Configured } from "../services/uploads-presign.service.js";

const SIGNED_OBJECT_URL_EXPIRES_SEC = 3600;

export type ObjectDisplayUrls = {
  /** Preferred URL (public CDN when `PUBLIC_OBJECT_BASE_URL` is set). */
  url: string | null;
  /** Signed R2 GET URL when public may fail (rate limits); omitted when redundant. */
  fallbackUrl: string | null;
};

/** Builds a public URL for an R2 object key when `PUBLIC_OBJECT_BASE_URL` is set. */
export function publicUrlFromObjectKey(objectKey: string | null | undefined): string | null {
  if (!objectKey) return null;
  const base = env.PUBLIC_OBJECT_BASE_URL?.replace(/\/$/, "");
  const key = objectKey.replace(/^\//, "");
  return base ? `${base}/${key}` : null;
}

async function signedObjectDisplayUrl(objectKey: string): Promise<string | null> {
  if (!r2Configured() || !env.R2_BUCKET) return null;
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: objectKey });
  return getSignedUrl(client, command, { expiresIn: SIGNED_OBJECT_URL_EXPIRES_SEC });
}

/**
 * Resolves display URLs for an object: public CDN when configured, plus a signed R2
 * fallback when both are available (e.g. dev public URL rate limits).
 */
export async function resolveObjectDisplayUrls(
  objectKey: string | null | undefined,
): Promise<ObjectDisplayUrls> {
  if (!objectKey?.trim()) return { url: null, fallbackUrl: null };
  const publicUrl = publicUrlFromObjectKey(objectKey);
  const signedUrl = await signedObjectDisplayUrl(objectKey);
  if (publicUrl && signedUrl) {
    return { url: publicUrl, fallbackUrl: signedUrl };
  }
  const url = publicUrl ?? signedUrl;
  return { url, fallbackUrl: null };
}

/** Public CDN URL when configured; otherwise a short-lived signed GET URL for private R2. */
export async function resolveObjectDisplayUrl(
  objectKey: string | null | undefined,
): Promise<string | null> {
  const { url } = await resolveObjectDisplayUrls(objectKey);
  return url;
}
