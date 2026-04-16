import { SubmissionStatus } from "../generated/prisma/enums.js";
import { dec, prisma } from "../lib/prisma.js";

/** Client — `GET /client/dashboard` — metrics returned at top level of `data`. */
export async function getClientDashboard(clientId: string) {
  const [campaignCount, budgetAgg, submissionsPending, paidAgg] =
    await Promise.all([
      prisma.campaign.count({ where: { clientId } }),
      prisma.campaign.aggregate({
        where: { clientId },
        _sum: { budget: true },
      }),
      prisma.submission.count({
        where: {
          campaign: { clientId },
          status: { in: [SubmissionStatus.submitted, SubmissionStatus.in_review] },
        },
      }),
      prisma.submission.aggregate({
        where: {
          campaign: { clientId },
          status: SubmissionStatus.approved,
        },
        _sum: { payoutAmount: true },
      }),
    ]);

  const totalPaid = paidAgg._sum.payoutAmount
    ? Number(dec(paidAgg._sum.payoutAmount))
    : 0;
  const budgetFunded = budgetAgg._sum.budget
    ? Number(dec(budgetAgg._sum.budget))
    : 0;

  return {
    totalCampaigns: campaignCount,
    budgetFunded,
    totalPaid,
    pendingReview: submissionsPending,
  };
}

export async function getTesterDashboard(testerId: string) {
  const [totalEarningsAgg, forReview, approvedCount, rejectedCount] =
    await Promise.all([
      prisma.submission.aggregate({
        where: { testerId, status: SubmissionStatus.approved },
        _sum: { payoutAmount: true },
      }),
      prisma.submission.count({
        where: {
          testerId,
          status: {
            in: [SubmissionStatus.submitted, SubmissionStatus.in_review],
          },
        },
      }),
      prisma.submission.count({
        where: { testerId, status: SubmissionStatus.approved },
      }),
      prisma.submission.count({
        where: { testerId, status: SubmissionStatus.rejected },
      }),
    ]);

  const totalEarnings = totalEarningsAgg._sum.payoutAmount
    ? Number(dec(totalEarningsAgg._sum.payoutAmount))
    : 0;

  const decided = approvedCount + rejectedCount;
  const acceptanceRatePercent =
    decided > 0 ? Math.round((approvedCount / decided) * 100) : null;

  return {
    totalEarnings,
    forReview,
    acceptanceRatePercent,
  };
}
