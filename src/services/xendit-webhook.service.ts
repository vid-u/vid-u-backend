import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import {
  applyInvoicePaid,
  applyReleaseFailed,
  applyReleaseSuccess,
} from "./ledger.service.js";

export async function applyFundingInvoicePaid(args: {
  externalId: string;
  invoiceId: string;
  amount: number;
}): Promise<void> {
  const session = await prisma.fundingCheckoutSession.findUnique({
    where: { externalId: args.externalId },
  });
  if (!session || session.status === "paid") return;

  const gross = new Prisma.Decimal(args.amount);
  await applyInvoicePaid({
    campaignId: session.campaignId,
    invoiceId: args.invoiceId,
    externalId: args.externalId,
    grossAmount: gross,
    sessionId: session.id,
  });
}

export async function dispatchPayoutWebhook(input: {
  payoutId: string;
  status: string;
  submissionId: string;
  failureReason: string;
  feeAmount: number;
}): Promise<void> {
  if (input.status === "SUCCEEDED" || input.status === "COMPLETED") {
    await applyReleaseSuccess({
      submissionId: input.submissionId,
      payoutId: input.payoutId,
      xenditFee: new Prisma.Decimal(input.feeAmount),
    });
    return;
  }
  if (input.status === "FAILED") {
    await applyReleaseFailed({
      submissionId: input.submissionId,
      payoutId: input.payoutId,
      failureReason: input.failureReason,
    });
  }
}
