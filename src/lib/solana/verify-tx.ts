import { getProgramId, getSolanaConnection } from "./config.js";
import { campaignPda, submissionPda } from "./pdas.js";
import { findIxMatching } from "./tx-parse.js";

const APPROVE_DISC = Uint8Array.from([
  154, 76, 116, 120, 143, 128, 16, 205,
]);
const REJECT_DISC = Uint8Array.from([2, 92, 1, 81, 148, 156, 6, 160]);

export async function verifyApproveSubmissionTx(
  signature: string,
  input: { campaignUuid: string; submissionUuid: string },
): Promise<void> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const campPk = campaignPda(programPk, input.campaignUuid);
  const subPk = submissionPda(programPk, campPk, input.submissionUuid);

  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) {
    throw new Error("Approve transaction not found or failed on-chain");
  }

  const ok = findIxMatching(tx, programPk, APPROVE_DISC, (keys, ai) => {
    if (ai.length < 4) return false;
    return Boolean(keys.get(ai[3])?.equals(subPk));
  });
  if (!ok) {
    throw new Error("Transaction is not a valid approve_submission for this submission");
  }
}

export async function verifyRejectSubmissionTx(
  signature: string,
  input: { campaignUuid: string; submissionUuid: string },
): Promise<void> {
  const connection = getSolanaConnection();
  const programPk = getProgramId();
  const campPk = campaignPda(programPk, input.campaignUuid);
  const subPk = submissionPda(programPk, campPk, input.submissionUuid);

  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) {
    throw new Error("Reject transaction not found or failed on-chain");
  }

  const ok = findIxMatching(tx, programPk, REJECT_DISC, (keys, ai) => {
    if (ai.length < 4) return false;
    return Boolean(keys.get(ai[3])?.equals(subPk));
  });
  if (!ok) {
    throw new Error("Transaction is not a valid reject_submission for this submission");
  }
}
