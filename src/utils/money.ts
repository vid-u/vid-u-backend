import { Prisma } from "../generated/prisma/client.js";
import {
  CREATOR_PAYOUT_SHARE,
  PLATFORM_DEPOSIT_FEE_PERCENT,
} from "../config/fees.js";

export function toDecimal(n: number | string | Prisma.Decimal): Prisma.Decimal {
  return n instanceof Prisma.Decimal ? n : new Prisma.Decimal(n);
}

export function netBudgetFromGross(grossBudget: Prisma.Decimal): Prisma.Decimal {
  return grossBudget.mul(toDecimal(1 - PLATFORM_DEPOSIT_FEE_PERCENT));
}

/** creator_net = gross_amount * CREATOR_PAYOUT_SHARE */
export function creatorNetFromGross(gross: Prisma.Decimal): Prisma.Decimal {
  return gross.mul(toDecimal(CREATOR_PAYOUT_SHARE));
}

export function grossFromFundedViews(
  fundedViews: bigint,
  ratePer1k: Prisma.Decimal,
): Prisma.Decimal {
  const views = new Prisma.Decimal(fundedViews.toString());
  return views.mul(ratePer1k).div(toDecimal(1000));
}
