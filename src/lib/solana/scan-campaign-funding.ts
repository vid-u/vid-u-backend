import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import type { VersionedTransactionResponse } from "@solana/web3-compat";
import { PublicKey } from "@solana/web3-compat";
import { getProgramId, getSolanaConnection } from "./config.js";
import { campaignPda, uuidToU8_16 } from "./pdas.js";
import {
  accountKeysForTx,
  disc8,
  eq8,
  eachOuterProgramInstruction,
  findIxMatchingOuter,
  readU64Le,
} from "./tx-parse.js";

const INIT_DISC = Uint8Array.from([169, 88, 7, 6, 9, 165, 65, 132]);
const FUND_DISC = Uint8Array.from([109, 57, 56, 239, 99, 111, 221, 121]);

/** Seconds before DB `created_at` to include (clock skew). */
const TIME_WINDOW_START_BUFFER_SEC = 300;
const MAX_SIGNATURE_PAGES = 40;
const MAX_SIGNATURES_TO_FETCH = 120;

export type RecoveredFunding = {
  initializeTxSignature: string;
  fundTxSignature: string;
  fundedAmountMicro: bigint;
};

function hasInitializeOuter(
  tx: VersionedTransactionResponse,
  programPk: PublicKey,
  campaignUuid: string,
  clientPk: PublicKey,
): boolean {
  const expectedCamp = campaignPda(programPk, campaignUuid);
  const uuidBytes = uuidToU8_16(campaignUuid);
  return findIxMatchingOuter(tx, programPk, INIT_DISC, (keys, ai, data) => {
    if (ai.length < 3) return false;
    if (!keys.get(ai[0]!)?.equals(clientPk)) return false;
    if (!keys.get(ai[2]!)?.equals(expectedCamp)) return false;
    if (data.length < 8 + 16) return false;
    for (let i = 0; i < 16; i++) {
      if (data[8 + i] !== uuidBytes[i]) return false;
    }
    return true;
  });
}

function parseFundAmountOuter(
  tx: VersionedTransactionResponse,
  programPk: PublicKey,
  campaignUuid: string,
  clientPk: PublicKey,
): bigint | null {
  const expectedCamp = campaignPda(programPk, campaignUuid);
  const keys = accountKeysForTx(tx);
  for (const ix of eachOuterProgramInstruction(tx)) {
    const pid = keys.get(ix.programIdIndex);
    if (!pid || !pid.equals(programPk)) continue;
    if (ix.data.length < 8 || !eq8(disc8(ix.data), FUND_DISC)) continue;
    if (ix.accountKeyIndexes.length < 3) continue;
    if (!keys.get(ix.accountKeyIndexes[0]!)?.equals(clientPk)) continue;
    if (!keys.get(ix.accountKeyIndexes[2]!)?.equals(expectedCamp)) continue;
    if (ix.data.length < 16) continue;
    return readU64Le(ix.data, 8);
  }
  return null;
}

/**
 * Pair `initialize_campaign` + `fund_campaign` for this campaign (same tx or init before fund).
 * Returns signatures to store (may be identical if both ixs are in one transaction).
 */
export function pairInitAndFund(
  txs: { sig: string; tx: VersionedTransactionResponse }[],
  campaignUuid: string,
  clientWalletBase58: string,
): RecoveredFunding | null {
  const programPk = getProgramId();
  const clientPk = new PublicKey(clientWalletBase58.trim());

  const sorted = [...txs].sort((a, b) => {
    const ta = a.tx.blockTime ?? 0;
    const tb = b.tx.blockTime ?? 0;
    if (ta !== tb) return ta - tb;
    return a.sig.localeCompare(b.sig);
  });

  for (const row of sorted) {
    const init = hasInitializeOuter(row.tx, programPk, campaignUuid, clientPk);
    const amt = parseFundAmountOuter(row.tx, programPk, campaignUuid, clientPk);
    if (init && amt != null) {
      return {
        initializeTxSignature: row.sig,
        fundTxSignature: row.sig,
        fundedAmountMicro: amt,
      };
    }
  }

  for (let j = 0; j < sorted.length; j++) {
    const fundAmt = parseFundAmountOuter(sorted[j]!.tx, programPk, campaignUuid, clientPk);
    if (fundAmt == null) continue;
    for (let i = 0; i <= j; i++) {
      if (hasInitializeOuter(sorted[i]!.tx, programPk, campaignUuid, clientPk)) {
        return {
          initializeTxSignature: sorted[i]!.sig,
          fundTxSignature: sorted[j]!.sig,
          fundedAmountMicro: fundAmt,
        };
      }
    }
  }

  return null;
}

/**
 * Collect signatures for `campaignPda` since `campaignCreatedAt` (with buffer), then load txs
 * and try to recover init+fund wiring matching the client wallet.
 */
export async function scanCampaignFundingOnChain(input: {
  campaignUuid: string;
  clientWalletBase58: string;
  campaignCreatedAt: Date;
}): Promise<RecoveredFunding | null> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const campaignPk = campaignPda(programPk, input.campaignUuid);
  const minBlockTime =
    Math.floor(input.campaignCreatedAt.getTime() / 1000) - TIME_WINDOW_START_BUFFER_SEC;

  const signatureInfos: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;

  outer: for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
    const batch = await connection.getSignaturesForAddress(campaignPk, {
      limit: 1000,
      before,
    });
    if (batch.length === 0) break;

    for (const info of batch) {
      if (info.blockTime == null) {
        if (signatureInfos.length < MAX_SIGNATURES_TO_FETCH) {
          signatureInfos.push(info);
        }
        continue;
      }
      if (info.blockTime >= minBlockTime) {
        if (signatureInfos.length < MAX_SIGNATURES_TO_FETCH) {
          signatureInfos.push(info);
        }
      } else {
        break outer;
      }
    }

    before = batch[batch.length - 1]!.signature;
  }

  const rows: { sig: string; tx: VersionedTransactionResponse }[] = [];

  for (const info of signatureInfos) {
    const tx = await connection.getTransaction(info.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || tx.meta?.err) continue;
    if (tx.blockTime != null && tx.blockTime < minBlockTime) continue;
    rows.push({ sig: info.signature, tx });
  }

  if (rows.length === 0) return null;

  return pairInitAndFund(rows, input.campaignUuid, input.clientWalletBase58.trim());
}
