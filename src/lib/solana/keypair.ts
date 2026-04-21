import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3-compat";
import { env } from "../env.js";

export function loadBackendAuthorityKeypair(): Keypair {
  const raw = env.BACKEND_AUTHORITY_SECRET?.trim();
  if (!raw) {
    throw new Error("BACKEND_AUTHORITY_SECRET is not set");
  }
  if (raw.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  }
  const fileContent = readFileSync(raw, "utf8").trim();
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fileContent) as number[]));
}
