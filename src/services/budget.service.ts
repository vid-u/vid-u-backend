import type { Campaign, Submission } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { netBudgetFromGross, toDecimal } from "../utils/money.js";

const RESERVED_STATUSES = new Set<string>(["pending", "paying", "payout_failed"]);

function moneyString(d: Prisma.Decimal): string {
  return d.toFixed(2);
}

export function sumReservedGross(
  submissions: Pick<Submission, "status" | "grossAmount">[],
): Prisma.Decimal {
  let sum = toDecimal(0);
  for (const s of submissions) {
    if (RESERVED_STATUSES.has(s.status)) {
      sum = sum.add(s.grossAmount);
    }
  }
  return sum;
}

export type CampaignBalances = {
  grossBudget: string;
  spentBudget: string;
  netBudget: string;
  reservedBudget: string;
  /** Net pool not locked in a pending brand refund (for UI “Payout pool”). */
  payoutPoolBudget: string;
  /** Net held for an in-flight brand refund payout. */
  pendingRefundBudget: string;
  availableBudget: string;
};

export function computeCampaignBalances(
  campaign: Pick<Campaign, "grossBudget" | "spentBudget">,
  submissions: Pick<Submission, "status" | "grossAmount">[],
  pendingRefundNet: Prisma.Decimal = toDecimal(0),
): CampaignBalances {
  const gross = toDecimal(campaign.grossBudget);
  const spent = toDecimal(campaign.spentBudget);
  const net = netBudgetFromGross(gross);
  const reserved = sumReservedGross(submissions);
  const pendingRefund = pendingRefundNet.gt(0) ? pendingRefundNet : toDecimal(0);
  let payoutPool = net.sub(pendingRefund);
  if (payoutPool.lt(0)) {
    payoutPool = toDecimal(0);
  }
  let available = net.sub(spent).sub(reserved).sub(pendingRefund);
  if (available.lt(0)) {
    available = toDecimal(0);
  }
  return {
    grossBudget: moneyString(gross),
    spentBudget: moneyString(spent),
    netBudget: moneyString(net),
    reservedBudget: moneyString(reserved),
    payoutPoolBudget: moneyString(payoutPool),
    pendingRefundBudget: moneyString(pendingRefund),
    availableBudget: moneyString(available),
  };
}
