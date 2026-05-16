import { Prisma } from "../generated/prisma/client.js";
import {
  CampaignStatus,
  LedgerType,
  SessionStatus,
  SubmissionStatus,
} from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { netBudgetFromGross, toDecimal } from "../utils/money.js";
import { MIN_PUBLISH_SPENDABLE_FLOOR_PHP, PLATFORM_DEPOSIT_FEE_PERCENT } from "../config/fees.js";
import { getPendingBrandRefundNet } from "./brand-refund.service.js";
import { computeCampaignBalances } from "./budget.service.js";

export async function findLedgerByIdempotencyKey(idempotencyKey: string) {
  return prisma.ledgerEntry.findFirst({ where: { idempotencyKey } });
}

export async function insertLedgerEntry(data: Prisma.LedgerEntryUncheckedCreateInput) {
  return prisma.ledgerEntry.create({ data });
}

export async function recomputeCampaignCachesFromLedger(campaignId: string) {
  const rows = await prisma.ledgerEntry.groupBy({
    by: ["ledgerType"],
    where: { campaignId },
    _sum: { amountGross: true },
  });
  let deposits = toDecimal(0);
  let refunds = toDecimal(0);
  let releases = toDecimal(0);
  for (const r of rows) {
    const sum =
      r._sum?.amountGross == null ? toDecimal(0) : toDecimal(r._sum.amountGross);
    if (r.ledgerType === LedgerType.deposit) deposits = deposits.add(sum);
    if (r.ledgerType === LedgerType.refund_available) refunds = refunds.add(sum);
    if (r.ledgerType === LedgerType.release) releases = releases.add(sum);
  }
  const grossBudget = deposits.sub(refunds);
  const spentBudget = releases;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { grossBudget, spentBudget },
  });
  return { grossBudget, spentBudget };
}

export async function maybeAutoPauseCampaignTx(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<void> {
  const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status !== CampaignStatus.active) return;
  const subs = await tx.submission.findMany({
    where: { campaignId },
    select: { status: true, grossAmount: true },
  });
  const pendingRefundNet = await getPendingBrandRefundNet(campaignId);
  const { availableBudget } = computeCampaignBalances(campaign, subs, pendingRefundNet);
  const avail = toDecimal(availableBudget);
  if (avail.lt(toDecimal(MIN_PUBLISH_SPENDABLE_FLOOR_PHP))) {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.paused },
    });
    await tx.ledgerEntry.create({
      data: {
        campaignId,
        ledgerType: LedgerType.adjustment,
        amountGross: toDecimal(0),
        note: `auto_pause:available_below_floor:${MIN_PUBLISH_SPENDABLE_FLOOR_PHP}`,
      },
    });
  }
}

export async function maybeResumeAfterDepositTx(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<void> {
  const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status !== CampaignStatus.paused) return;
  const subs = await tx.submission.findMany({
    where: { campaignId },
    select: { status: true, grossAmount: true },
  });
  const pendingRefundNet = await getPendingBrandRefundNet(campaignId);
  const { availableBudget } = computeCampaignBalances(campaign, subs, pendingRefundNet);
  const avail = toDecimal(availableBudget);
  if (avail.gte(toDecimal(MIN_PUBLISH_SPENDABLE_FLOOR_PHP))) {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.active },
    });
    await tx.ledgerEntry.create({
      data: {
        campaignId,
        ledgerType: LedgerType.adjustment,
        amountGross: toDecimal(0),
        note: "auto_resume:deposit_crossed_publish_floor",
      },
    });
  }
}

function recomputeGoalViewsOnDeposit(
  currentGoal: bigint,
  grossBudget: Prisma.Decimal,
  ratePer1k: Prisma.Decimal,
): bigint {
  const net = netBudgetFromGross(toDecimal(grossBudget));
  const capNum = Math.floor(Number(net.mul(1000).div(ratePer1k).toString()));
  const capBi = BigInt(Math.max(0, capNum));
  return capBi > currentGoal ? capBi : currentGoal;
}

export async function applyInvoicePaid(input: {
  campaignId: string;
  invoiceId: string;
  externalId: string;
  grossAmount: Prisma.Decimal;
  sessionId: string;
}): Promise<{ created: boolean }> {
  const idempotencyKey = `invoice:${input.invoiceId}`;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findFirst({ where: { idempotencyKey } });
    if (existing) {
      await tx.fundingCheckoutSession.updateMany({
        where: { id: input.sessionId, status: { not: SessionStatus.paid } },
        data: { status: SessionStatus.paid },
      });
      return { created: false };
    }

    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
    });
    const newGross = toDecimal(campaign.grossBudget).add(input.grossAmount);
    const newGoal = recomputeGoalViewsOnDeposit(
      campaign.goalViews,
      newGross,
      toDecimal(campaign.ratePer1k),
    );

    const firstDeposit = toDecimal(campaign.grossBudget).eq(0);
    const nextStatus =
      firstDeposit && campaign.status === CampaignStatus.draft
        ? CampaignStatus.active
        : campaign.status;

    const platformFee = input.grossAmount.mul(toDecimal(PLATFORM_DEPOSIT_FEE_PERCENT));
    const amountNet = input.grossAmount.sub(platformFee);

    await tx.ledgerEntry.create({
      data: {
        campaignId: input.campaignId,
        ledgerType: LedgerType.deposit,
        amountGross: input.grossAmount,
        amountNet,
        platformFeeAmount: platformFee,
        xenditInvoiceId: input.invoiceId,
        idempotencyKey,
        note: firstDeposit ? "initial_fund" : "top_up",
      },
    });

    await tx.campaign.update({
      where: { id: input.campaignId },
      data: {
        grossBudget: newGross,
        goalViews: newGoal,
        status: nextStatus,
      },
    });

    await tx.fundingCheckoutSession.update({
      where: { id: input.sessionId },
      data: { status: SessionStatus.paid },
    });

    await maybeAutoPauseCampaignTx(tx, input.campaignId);
    await maybeResumeAfterDepositTx(tx, input.campaignId);

    return { created: true };
  });
}

/** @deprecated Prefer `brand-refund.service` (Xendit payout + webhook). Kept for admin/reconcile paths. */
export async function applyRefund(input: {
  campaignId: string;
  amountGross: Prisma.Decimal;
  idempotencyKey: string;
  note?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return;

    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: input.campaignId } });
    const subs = await tx.submission.findMany({
      where: { campaignId: input.campaignId, status: { not: SubmissionStatus.rejected } },
      select: { fundedViews: true },
    });
    const pinnedViews = subs.reduce((a, s) => a + s.fundedViews, 0n);

    await tx.ledgerEntry.create({
      data: {
        campaignId: input.campaignId,
        ledgerType: LedgerType.refund_available,
        amountGross: input.amountGross,
        idempotencyKey: input.idempotencyKey,
        note: input.note,
      },
    });

    const newGross = toDecimal(campaign.grossBudget).sub(input.amountGross);
    const clamped = newGross.lt(0) ? toDecimal(0) : newGross;
    await tx.campaign.update({
      where: { id: input.campaignId },
      data: {
        grossBudget: clamped,
        goalViews: pinnedViews,
      },
    });

    await maybeAutoPauseCampaignTx(tx, input.campaignId);
  });
}

export async function applyBrandRefundSuccess(input: {
  attemptId: string;
  campaignId: string;
  payoutId: string;
  amountGross: Prisma.Decimal;
  amountNet: Prisma.Decimal;
  xenditFee: Prisma.Decimal;
}): Promise<void> {
  const idempotencyKey = `refund:complete:${input.payoutId}`;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findFirst({ where: { idempotencyKey } });
    if (existing) return;

    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: input.campaignId } });
    const subs = await tx.submission.findMany({
      where: { campaignId: input.campaignId, status: { not: SubmissionStatus.rejected } },
      select: { fundedViews: true },
    });
    const pinnedViews = subs.reduce((a, s) => a + s.fundedViews, 0n);
    /** Deposit fee not returned to brand (gross pool debit minus net sent). */
    const platformFee = input.amountGross.sub(input.amountNet);
    const platformFeeClamped = platformFee.lt(0) ? toDecimal(0) : platformFee;

    await tx.ledgerEntry.create({
      data: {
        campaignId: input.campaignId,
        ledgerType: LedgerType.refund_available,
        amountGross: input.amountGross,
        amountNet: input.amountNet,
        xenditPayoutId: input.payoutId,
        xenditFeeAmount: input.xenditFee,
        platformFeeAmount: platformFeeClamped,
        idempotencyKey,
        note: "brand_refund_available",
      },
    });

    const newGross = toDecimal(campaign.grossBudget).sub(input.amountGross);
    const clamped = newGross.lt(0) ? toDecimal(0) : newGross;
    await tx.campaign.update({
      where: { id: input.campaignId },
      data: {
        grossBudget: clamped,
        goalViews: pinnedViews,
      },
    });

    await maybeAutoPauseCampaignTx(tx, input.campaignId);
  });
}

export async function applyBrandRefundFailed(input: {
  attemptId: string;
  campaignId: string;
  payoutId: string;
  failureReason: string;
}): Promise<void> {
  const idempotencyKey = `refund:failed:${input.payoutId}`;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findFirst({ where: { idempotencyKey } });
    if (existing) return;

    await tx.ledgerEntry.create({
      data: {
        campaignId: input.campaignId,
        ledgerType: LedgerType.release_failed,
        amountGross: toDecimal(0),
        xenditPayoutId: input.payoutId,
        failureReason: input.failureReason,
        idempotencyKey,
        note: "brand_refund_failed",
      },
    });
  });
}

export async function applyReleaseSuccess(input: {
  submissionId: string;
  payoutId: string;
  xenditFee: Prisma.Decimal;
}): Promise<void> {
  const idempotencyKey = `payout:${input.payoutId}`;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findFirst({ where: { idempotencyKey } });
    if (existing) return;

    const submission = await tx.submission.findUniqueOrThrow({
      where: { id: input.submissionId },
    });
    if (submission.status !== "paying") {
      return;
    }

    const gross = toDecimal(submission.grossAmount);
    const net = toDecimal(submission.creatorNet);
    const platformFee = gross.sub(net).sub(input.xenditFee);

    await tx.ledgerEntry.create({
      data: {
        campaignId: submission.campaignId,
        ledgerType: LedgerType.release,
        amountGross: gross,
        amountNet: net,
        xenditPayoutId: input.payoutId,
        xenditFeeAmount: input.xenditFee,
        platformFeeAmount: platformFee,
        relatedSubmissionId: submission.id,
        idempotencyKey,
      },
    });

    await tx.submission.update({
      where: { id: submission.id },
      data: { status: "paid", paidAt: new Date() },
    });

    await tx.campaign.update({
      where: { id: submission.campaignId },
      data: { spentBudget: { increment: gross } },
    });

    await maybeAutoPauseCampaignTx(tx, submission.campaignId);
  });
}

export async function applyReleaseFailed(input: {
  submissionId: string;
  payoutId: string;
  failureReason: string;
}): Promise<void> {
  const idempotencyKey = `payout_failed:${input.payoutId}`;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findFirst({ where: { idempotencyKey } });
    if (existing) return;

    const submission = await tx.submission.findUniqueOrThrow({
      where: { id: input.submissionId },
    });
    if (submission.status !== "paying") return;

    await tx.ledgerEntry.create({
      data: {
        campaignId: submission.campaignId,
        ledgerType: LedgerType.release_failed,
        amountGross: toDecimal(0),
        xenditPayoutId: input.payoutId,
        failureReason: input.failureReason,
        relatedSubmissionId: submission.id,
        idempotencyKey,
      },
    });

    await tx.submission.update({
      where: { id: submission.id },
      data: { status: "payout_failed" },
    });
  });
}

export async function insertManualAdjustment(input: {
  campaignId: string;
  idempotencyKey: string;
  amountGross: Prisma.Decimal;
  note?: string;
}): Promise<void> {
  await prisma.ledgerEntry.create({
    data: {
      campaignId: input.campaignId,
      ledgerType: LedgerType.adjustment,
      amountGross: input.amountGross,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
    },
  });
}
