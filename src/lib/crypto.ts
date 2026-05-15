import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "./env.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function getKey(): Buffer {
  const hex = env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== KEY_LEN) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return buf;
}

/** Dev-only weak key derived from NODE_ENV — never use in production without TOKEN_ENCRYPTION_KEY. */
function devFallbackKey(): Buffer {
  return scryptSync("vidu-dev-token-key", "salt", KEY_LEN);
}

function resolveKey(): Buffer {
  try {
    return getKey();
  } catch {
    if (env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENCRYPTION_KEY is required in production");
    }
    return devFallbackKey();
  }
}

export function encryptSecret(plain: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const key = resolveKey();
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + 16);
  const data = raw.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
