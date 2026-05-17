import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { CampaignStatus, LedgerType, SubmissionStatus } from "../generated/prisma/enums.js";
import { maybeResumeAfterDeposit } from "./auto-pause.service.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { grossFromNetBudget, toDecimal } from "../utils/money.js";
import { computeCampaignBalances } from "./budget.service.js";
import { getDefaultPaymentMethodForPayout } from "./payment-methods-payout.service.js";
import {
  applyBrandRefundFailed,
  applyBrandRefundSuccess,
} from "./ledger.service.js";
import {
  BRAND_REFUND_LEDGER_NOTE,
  createXenditDisbursement,
} from "./xendit-payout.service.js";

function decimalString(d: Prisma.Decimal): string {
  return d.toFixed(2);
}

async function findInFlightBrandRefund(campaignId: string) {
  const attempt = await prisma.ledgerEntry.findFirst({
    where: {
      campaignId,
      ledgerType: LedgerType.release_attempt,
      note: `${BRAND_REFUND_LEDGER_NOTE}_pending`,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!attempt?.xenditPayoutId) return null;

  const settled = await prisma.ledgerEntry.findFirst({
    where: {
      campaignId,
      xenditPayoutId: attempt.xenditPayoutId,
      ledgerType: { in: [LedgerType.refund_available, LedgerType.release_failed] },
    },
  });
  return settled ? null : attempt;
}

export async function hasInFlightBrandRefund(campaignId: string): Promise<boolean> {
  return (await findInFlightBrandRefund(campaignId)) !== null;
}

export function pendingRefundNetFromAttempt(
  attempt: Pick<{ amountGross: Prisma.Decimal; amountNet: Prisma.Decimal | null }, "amountGross" | "amountNet"> | null,
): Prisma.Decimal {
  if (!attempt) return toDecimal(0);
  if (attempt.amountNet != null && attempt.amountNet.gt(0)) {
    return attempt.amountNet;
  }
  return attempt.amountGross.gt(0) ? attempt.amountGross : toDecimal(0);
}

/** Net amount locked while Xendit processes a brand balance refund. */
export async function getPendingBrandRefundNet(campaignId: string): Promise<Prisma.Decimal> {
  return pendingRefundNetFromAttempt(await findInFlightBrandRefund(campaignId));
}

async function createPendingRefundAttempt(input: {
  attemptId: string;
  campaignId: string;
  grossDebit: Prisma.Decimal;
  availableNet: Prisma.Decimal;
  payoutId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: {
        id: input.attemptId,
        campaignId: input.campaignId,
        ledgerType: LedgerType.release_attempt,
        amountGross: input.grossDebit,
        amountNet: input.availableNet,
        idempotencyKey: `refund:attempt:${input.attemptId}`,
        note: `${BRAND_REFUND_LEDGER_NOTE}_pending`,
        xenditPayoutId: input.payoutId,
      },
    });
    const subs = await tx.submission.findMany({
      where: {
        campaignId: input.campaignId,
        status: { not: SubmissionStatus.rejected },
      },
      select: { fundedViews: true },
    });
    const pinnedViews = subs.reduce((a, s) => a + s.fundedViews, 0n);

    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
    });
    const updates: { status?: CampaignStatus; goalViews: bigint } = {
      goalViews: pinnedViews,
    };
    if (campaign.status === CampaignStatus.active) {
      updates.status = CampaignStatus.paused;
    }
    await tx.campaign.update({
      where: { id: input.campaignId },
      data: updates,
    });
  });
}

/**
 * Sends available balance to the brand's default `brand_refund` payment method via Xendit.
 * Campaign `gross_budget` is reduced only after the payout webhook reports success.
 */
export async function refundAvailableCampaignBalance(
  brandUserId: string,
  campaignId: string,
): Promise<{ refunded: string; payoutId?: string }> {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, brandUserId } });
  if (!c) throw new NotFoundError("Campaign not found");

  const inFlight = await findInFlightBrandRefund(campaignId);
  if (inFlight) {
    throw new ConflictError("refund_in_progress");
  }

  const subs = await prisma.submission.findMany({
    where: { campaignId },
    select: { status: true, grossAmount: true },
  });
  const balances = computeCampaignBalances(c, subs);
  const availableNet = new Prisma.Decimal(balances.availableBudget);
  if (availableNet.lte(0)) throw new ConflictError("No available balance");

  const grossToRefund = grossFromNetBudget(availableNet);
  const currentGross = toDecimal(c.grossBudget);
  const grossDebit = Prisma.Decimal.min(grossToRefund, currentGross);

  const paymentMethod = await getDefaultPaymentMethodForPayout(brandUserId, "brand_refund");
  const attemptId = randomUUID();
  const idempotencyKey = `refund:${campaignId}:${attemptId}`;
  const amountNetPhp = Number(availableNet.toFixed(2));

  if (!env.XENDIT_SECRET_KEY) {
    const devPayoutId = `dev_${attemptId}`;
    await createPendingRefundAttempt({
      attemptId,
      campaignId,
      grossDebit,
      availableNet,
      payoutId: devPayoutId,
    });
    await applyBrandRefundSuccess({
      attemptId,
      campaignId,
      payoutId: devPayoutId,
      amountGross: grossDebit,
      amountNet: availableNet,
      xenditFee: toDecimal(0),
    });
    return { refunded: decimalString(availableNet), payoutId: devPayoutId };
  }

  const { payoutId } = await createXenditDisbursement({
    idempotencyKey,
    referenceId: attemptId,
    paymentMethod,
    amountNetPhp,
    description: `Campaign refund ${c.title}`.slice(0, 100),
  });

  await createPendingRefundAttempt({
    attemptId,
    campaignId,
    grossDebit,
    availableNet,
    payoutId,
  });

  return { refunded: decimalString(availableNet), payoutId };
}

export async function dispatchBrandRefundPayoutWebhook(input: {
  attemptId: string;
  payoutId: string;
  status: string;
  failureReason: string;
  feeAmount: number;
}): Promise<void> {
  const attempt = await prisma.ledgerEntry.findUnique({
    where: { id: input.attemptId },
  });
  if (!attempt || attempt.note !== `${BRAND_REFUND_LEDGER_NOTE}_pending`) {
    return;
  }

  if (!attempt.xenditPayoutId || attempt.xenditPayoutId !== input.payoutId) {
    logger.warn("Brand refund webhook ignored: payout id does not match attempt", {
      attemptId: input.attemptId,
      webhookPayoutId: input.payoutId,
      attemptPayoutId: attempt.xenditPayoutId,
    });
    return;
  }

  const amountGross =
    attempt.amountGross.gt(0) ? attempt.amountGross : toDecimal(0);
  const amountNet =
    attempt.amountNet != null && attempt.amountNet.gt(0)
      ? attempt.amountNet
      : amountGross;

  if (input.status === "SUCCEEDED" || input.status === "COMPLETED") {
    await applyBrandRefundSuccess({
      attemptId: input.attemptId,
      campaignId: attempt.campaignId,
      payoutId: input.payoutId,
      amountGross,
      amountNet,
      xenditFee: new Prisma.Decimal(input.feeAmount),
    });
    return;
  }

  if (input.status === "FAILED") {
    await applyBrandRefundFailed({
      attemptId: input.attemptId,
      campaignId: attempt.campaignId,
      payoutId: input.payoutId,
      failureReason: input.failureReason,
    });
    await maybeResumeAfterDeposit(attempt.campaignId);
  }
}
