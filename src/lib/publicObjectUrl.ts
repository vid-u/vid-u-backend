import { env } from "./env.js";

/** Builds a public URL for an R2 object key when `PUBLIC_OBJECT_BASE_URL` is set. */
export function publicUrlFromObjectKey(objectKey: string | null | undefined): string | null {
  if (!objectKey) return null;
  const base = env.PUBLIC_OBJECT_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/${objectKey}` : null;
}
