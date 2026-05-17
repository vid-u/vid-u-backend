import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import {
  applyInvoicePaid,
  applyReleaseFailed,
  applyReleaseSuccess,
} from "./ledger.service.js";
import { dispatchBrandRefundPayoutWebhook } from "./brand-refund.service.js";
import {
  BRAND_REFUND_LEDGER_NOTE,
  isXenditPayoutFailed,
  isXenditPayoutSuccess,
} from "./xendit-payout.service.js";
import type {
  NormalizedXenditInvoiceWebhook,
  NormalizedXenditPayoutWebhook,
} from "./xendit-webhook-payload.js";
import {
  fundingPaidAmountMatchesSession,
  verifyFundingInvoiceWebhook,
  verifyPayoutWebhook,
} from "./xendit-webhook-verify.js";
import { logger } from "../utils/logger.js";

/**
 * Credits campaign funding from a paid Xendit invoice (webhook or sync).
 * Safe under duplicate webhook delivery, manual resend, and concurrent sync + webhook.
 */
export async function applyFundingInvoicePaid(args: {
  externalId: string;
  invoiceId: string;
  amount: number;
}): Promise<{ applied: boolean }> {
  const session = await prisma.fundingCheckoutSession.findUnique({
    where: { externalId: args.externalId },
  });
  if (!session) return { applied: false };

  const gross = new Prisma.Decimal(args.amount);
  const { created } = await applyInvoicePaid({
    campaignId: session.campaignId,
    invoiceId: args.invoiceId,
    externalId: args.externalId,
    grossAmount: gross,
    sessionId: session.id,
  });
  return { applied: created };
}

/** Invoice webhook: verify with Xendit API, then session amount + invoice id, then credit. */
export async function handleFundingInvoiceWebhook(
  webhook: NormalizedXenditInvoiceWebhook,
): Promise<void> {
  const verified = await verifyFundingInvoiceWebhook(webhook);
  if (!verified) return;

  const session = await prisma.fundingCheckoutSession.findUnique({
    where: { externalId: webhook.externalId },
  });
  if (!session) {
    logger.warn("Funding webhook ignored: checkout session not found", {
      externalId: webhook.externalId,
    });
    return;
  }

  if (session.xenditInvoiceId && session.xenditInvoiceId !== verified.invoiceId) {
    logger.warn("Funding webhook ignored: invoice id does not match checkout session", {
      externalId: webhook.externalId,
      sessionInvoiceId: session.xenditInvoiceId,
      xenditInvoiceId: verified.invoiceId,
    });
    return;
  }

  if (!fundingPaidAmountMatchesSession(verified.amount, session.grossAmount)) {
    logger.warn("Funding webhook ignored: paid amount does not match session gross", {
      externalId: webhook.externalId,
      paidAmount: verified.amount,
      sessionGross: session.grossAmount.toString(),
    });
    return;
  }

  if (!session.xenditInvoiceId) {
    await prisma.fundingCheckoutSession.update({
      where: { id: session.id },
      data: { xenditInvoiceId: verified.invoiceId },
    });
  }

  await applyFundingInvoicePaid({
    externalId: webhook.externalId,
    invoiceId: verified.invoiceId,
    amount: verified.amount,
  });
}

export async function dispatchPayoutWebhook(input: {
  payoutId: string;
  status: string;
  referenceId: string;
  failureReason: string;
  feeAmount: number;
}): Promise<void> {
  const brandRefundAttempt = await prisma.ledgerEntry.findFirst({
    where: {
      id: input.referenceId,
      note: `${BRAND_REFUND_LEDGER_NOTE}_pending`,
    },
  });
  if (brandRefundAttempt) {
    await dispatchBrandRefundPayoutWebhook({
      attemptId: input.referenceId,
      payoutId: input.payoutId,
      status: input.status,
      failureReason: input.failureReason,
      feeAmount: input.feeAmount,
    });
    return;
  }

  const submissionId = input.referenceId;
  if (isXenditPayoutSuccess(input.status)) {
    await applyReleaseSuccess({
      submissionId,
      payoutId: input.payoutId,
      xenditFee: new Prisma.Decimal(input.feeAmount),
    });
    return;
  }
  if (isXenditPayoutFailed(input.status)) {
    await applyReleaseFailed({
      submissionId,
      payoutId: input.payoutId,
      failureReason: input.failureReason,
    });
  }
}

/** Payout webhook: verify with Xendit API, then dispatch using provider-confirmed fields. */
export async function handlePayoutWebhook(
  webhook: NormalizedXenditPayoutWebhook,
): Promise<void> {
  const verified = await verifyPayoutWebhook(webhook);
  if (!verified) return;

  await dispatchPayoutWebhook({
    payoutId: verified.id,
    status: verified.status,
    referenceId: verified.referenceId,
    failureReason: verified.failureReason,
    feeAmount: verified.feeAmount,
  });
}
