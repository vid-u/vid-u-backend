import { PublicKey } from "@solana/web3-compat";

/** RFC-4122 UUID string → 16 bytes (same layout as on-chain `campaign_id` / `submission_id`). */
export function uuidToU8_16(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID for on-chain seed: ${uuid}`);
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function configPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bughyve_config")],
    programId,
  );
  return pda;
}

export function campaignPda(programId: PublicKey, campaignUuid: string): PublicKey {
  const id = uuidToU8_16(campaignUuid);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), Buffer.from(id)],
    programId,
  );
  return pda;
}

export function submissionPda(
  programId: PublicKey,
  campaignPubkey: PublicKey,
  submissionUuid: string,
): PublicKey {
  const subId = uuidToU8_16(submissionUuid);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("submission"), campaignPubkey.toBuffer(), Buffer.from(subId)],
    programId,
  );
  return pda;
}
