import { SubmissionStatus } from "../generated/prisma/enums.js";
import { stubTxSignature } from "../lib/stubChain.js";
import { prisma } from "../lib/prisma.js";

export async function runCheckExpired(): Promise<{
  processed: number;
  submissionIds: string[];
  txSignatures: string[];
}> {
  const now = new Date();
  const stuck = await prisma.submission.findMany({
    where: {
      expiresAt: { lt: now },
      status: {
        in: [
          SubmissionStatus.submitted,
          SubmissionStatus.in_review,
          SubmissionStatus.triaged,
        ],
      },
    },
  });

  const txSignatures: string[] = [];
  const ids: string[] = [];

  for (const s of stuck) {
    const tx = stubTxSignature("release_expired");
    txSignatures.push(tx);
    ids.push(s.id);

    await prisma.$transaction(async (trx) => {
      await trx.submission.update({
        where: { id: s.id },
        data: { status: SubmissionStatus.disputed },
      });
      await trx.submissionLog.create({
        data: {
          submissionId: s.id,
          actorId: null,
          eventType: "expiry_disputed",
          metadata: { pendingReleaseExpiredTx: tx },
        },
      });
    });
  }

  return { processed: stuck.length, submissionIds: ids, txSignatures };
}
