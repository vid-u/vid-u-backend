import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import {
  applyInvoicePaid,
  applyReleaseFailed,
  applyReleaseSuccess,
} from "./ledger.service.js";
import { dispatchBrandRefundPayoutWebhook } from "./brand-refund.service.js";
import { BRAND_REFUND_LEDGER_NOTE } from "./xendit-payout.service.js";

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
  if (input.status === "SUCCEEDED" || input.status === "COMPLETED") {
    await applyReleaseSuccess({
      submissionId,
      payoutId: input.payoutId,
      xenditFee: new Prisma.Decimal(input.feeAmount),
    });
    return;
  }
  if (input.status === "FAILED") {
    await applyReleaseFailed({
      submissionId,
      payoutId: input.payoutId,
      failureReason: input.failureReason,
    });
  }
}
