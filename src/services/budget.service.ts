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
  availableBudget: string;
};

export function computeCampaignBalances(
  campaign: Pick<Campaign, "grossBudget" | "spentBudget">,
  submissions: Pick<Submission, "status" | "grossAmount">[],
): CampaignBalances {
  const gross = toDecimal(campaign.grossBudget);
  const spent = toDecimal(campaign.spentBudget);
  const net = netBudgetFromGross(gross);
  const reserved = sumReservedGross(submissions);
  let available = net.sub(spent).sub(reserved);
  if (available.lt(0)) {
    available = toDecimal(0);
  }
  return {
    grossBudget: moneyString(gross),
    spentBudget: moneyString(spent),
    netBudget: moneyString(net),
    reservedBudget: moneyString(reserved),
    availableBudget: moneyString(available),
  };
}
