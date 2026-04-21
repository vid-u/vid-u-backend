import { PublicKey } from "@solana/web3-compat";
import { getProgramId, getSolanaConnection } from "./config.js";
import { campaignPda, submissionPda, uuidToU8_16 } from "./pdas.js";
import { findIxMatching, readU64Le } from "./tx-parse.js";

const INIT_DISC = Uint8Array.from([169, 88, 7, 6, 9, 165, 65, 132]);
const FUND_DISC = Uint8Array.from([109, 57, 56, 239, 99, 111, 221, 121]);
const CLOSE_DISC = Uint8Array.from([65, 49, 110, 7, 63, 238, 206, 77]);
const ALLOCATE_DISC = Uint8Array.from([124, 190, 60, 38, 198, 146, 130, 67]);

async function loadConfirmedTx(signature: string) {
  const connection = getSolanaConnection();
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) {
    throw new Error("Transaction not found or failed on-chain");
  }
  return tx;
}

/** `initialize_campaign` — campaign PDA at index 2; optional campaign_id bytes in ix data. */
export async function verifyInitializeCampaignTx(
  signature: string,
  input: { campaignUuid: string; clientWalletBase58: string },
): Promise<void> {
  const programPk = getProgramId();
  const expectedCamp = campaignPda(programPk, input.campaignUuid);
  const clientPk = new PublicKey(input.clientWalletBase58);
  const uuidBytes = uuidToU8_16(input.campaignUuid);
  const tx = await loadConfirmedTx(signature);
  const ok = findIxMatching(tx, programPk, INIT_DISC, (keys, ai, data) => {
    if (ai.length < 3) return false;
    if (!keys.get(ai[0]!)?.equals(clientPk)) return false;
    if (!keys.get(ai[2]!)?.equals(expectedCamp)) return false;
    if (data.length < 8 + 16) return false;
    for (let i = 0; i < 16; i++) {
      if (data[8 + i] !== uuidBytes[i]) return false;
    }
    return true;
  });
  if (!ok) throw new Error("Not a valid initialize_campaign for this campaign");
}

/** `fund_campaign` — amount (micro USDC) in instruction data after discriminator. */
export async function verifyFundCampaignTx(
  signature: string,
  input: {
    campaignUuid: string;
    clientWalletBase58: string;
    expectedAmountMicro: bigint;
  },
): Promise<void> {
  const programPk = getProgramId();
  const expectedCamp = campaignPda(programPk, input.campaignUuid);
  const clientPk = new PublicKey(input.clientWalletBase58);
  const tx = await loadConfirmedTx(signature);
  const ok = findIxMatching(tx, programPk, FUND_DISC, (keys, ai, data) => {
    if (ai.length < 3) return false;
    if (!keys.get(ai[0]!)?.equals(clientPk)) return false;
    if (!keys.get(ai[2]!)?.equals(expectedCamp)) return false;
    if (data.length < 16) return false;
    const amt = readU64Le(data, 8);
    return amt === input.expectedAmountMicro;
  });
  if (!ok) throw new Error("Not a valid fund_campaign with expected amount for this campaign");
}

/** `close_campaign` — client at 0, campaign at 2. */
export async function verifyCloseCampaignTx(
  signature: string,
  input: { campaignUuid: string; clientWalletBase58: string },
): Promise<void> {
  const programPk = getProgramId();
  const expectedCamp = campaignPda(programPk, input.campaignUuid);
  const clientPk = new PublicKey(input.clientWalletBase58);
  const tx = await loadConfirmedTx(signature);
  const ok = findIxMatching(tx, programPk, CLOSE_DISC, (keys, ai) => {
    if (ai.length < 3) return false;
    if (!keys.get(ai[0]!)?.equals(clientPk)) return false;
    return Boolean(keys.get(ai[2]!)?.equals(expectedCamp));
  });
  if (!ok) throw new Error("Not a valid close_campaign for this campaign");
}

/** Confirms `allocate_submission` locked this campaign + submission PDAs (recovery path). */
export async function verifyAllocateSubmissionTx(
  signature: string,
  input: { campaignUuid: string; submissionUuid: string },
): Promise<void> {
  const programPk = getProgramId();
  const campPk = campaignPda(programPk, input.campaignUuid);
  const subPk = submissionPda(programPk, campPk, input.submissionUuid);
  const tx = await loadConfirmedTx(signature);
  const ok = findIxMatching(tx, programPk, ALLOCATE_DISC, (keys, ai) => {
    if (ai.length < 4) return false;
    const campaignKey = keys.get(ai[2]!);
    const submissionKey = keys.get(ai[3]!);
    return Boolean(campaignKey?.equals(campPk) && submissionKey?.equals(subPk));
  });
  if (!ok) {
    throw new Error("Not a valid allocate_submission for this campaign and submission id");
  }
}
