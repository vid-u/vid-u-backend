import { readEnvInt } from "./read-env.js";

/** TTL (seconds) for `PUT` presigned URLs (default 15 minutes). */
export const UPLOAD_PRESIGN_EXPIRES_SEC = readEnvInt("UPLOAD_PRESIGN_EXPIRES_SEC", 15 * 60);

/** Max object size (bytes) the client should not exceed; enforced in bucket policy / CDN ideally. */
export const UPLOAD_MAX_BYTES = readEnvInt("UPLOAD_MAX_BYTES", 15 * 1024 * 1024);
