import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { MIN_PUBLISH_SPENDABLE_FLOOR_PHP } from "../config/fees.js";
import { netBudgetFromGross, toDecimal } from "../utils/money.js";
import { getPendingBrandRefundNet } from "./brand-refund.service.js";

/**
 * After money-moving commits: auto-pause if available pool below floor.
 */
export async function maybeAutoPauseCampaign(campaignId: string): Promise<void> {
  const pendingRefundNet = await getPendingBrandRefundNet(campaignId);
  await prisma.$transaction(async (tx) => {
    const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const agg = await tx.submission.aggregate({
      where: {
        campaignId,
        status: { in: ["pending", "paying", "payout_failed"] },
      },
      _sum: { grossAmount: true },
    });
    const reserved = agg._sum.grossAmount ?? new Prisma.Decimal(0);
    const net = netBudgetFromGross(c.grossBudget);
    const available = net.sub(c.spentBudget).sub(reserved).sub(pendingRefundNet);
    if (available.lt(toDecimal(MIN_PUBLISH_SPENDABLE_FLOOR_PHP)) && c.status === "active") {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: "paused" },
      });
    }
  });
}

/**
 * On deposit: resume from auto-pause if pool back above floor.
 */
export async function maybeResumeAfterDeposit(campaignId: string): Promise<void> {
  const pendingRefundNet = await getPendingBrandRefundNet(campaignId);
  await prisma.$transaction(async (tx) => {
    const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (c.status !== "paused") return;
    const agg = await tx.submission.aggregate({
      where: {
        campaignId,
        status: { in: ["pending", "paying", "payout_failed"] },
      },
      _sum: { grossAmount: true },
    });
    const reserved = agg._sum.grossAmount ?? new Prisma.Decimal(0);
    const net = netBudgetFromGross(c.grossBudget);
    const available = net.sub(c.spentBudget).sub(reserved).sub(pendingRefundNet);
    if (available.gte(toDecimal(MIN_PUBLISH_SPENDABLE_FLOOR_PHP))) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: "active" },
      });
    }
  });
}
