import { createHash } from "node:crypto";

/** Stub tx / PDA values until on-chain integration. */

export function stubTxSignature(prefix = "stub"): string {
  const h = createHash("sha256").update(`${prefix}:${Date.now()}`).digest("hex");
  return `${prefix}_${h.slice(0, 86)}`;
}

export function stubEscrowPda(campaignId: string): string {
  const h = createHash("sha256").update(campaignId).digest("hex");
  return `stubPda_${h.slice(0, 32)}`;
}
