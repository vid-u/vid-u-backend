import { SubmissionStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

/** Marks expired open submissions as disputed (no on-chain release instruction — bookkeeping only). */
export async function runCheckExpired(): Promise<{
  processed: number;
  submissionIds: string[];
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

  const ids: string[] = [];

  for (const s of stuck) {
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
          metadata: { source: "off_chain_expiry_cron" },
        },
      });
    });
  }

  return { processed: stuck.length, submissionIds: ids };
}
