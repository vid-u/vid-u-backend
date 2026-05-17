import { Prisma } from "../generated/prisma/client.js";
import { env } from "../lib/env.js";
import { getXenditInvoice } from "./xendit-invoice.service.js";
import {
  getXenditPayout,
  isDevXenditPayoutId,
  isXenditPayoutFailed,
  isXenditPayoutSuccess,
  type XenditPayoutSnapshot,
} from "./xendit-payout.service.js";
import type {
  NormalizedXenditInvoiceWebhook,
  NormalizedXenditPayoutWebhook,
} from "./xendit-webhook-payload.js";
import { logger } from "../utils/logger.js";

/** PHP amounts may differ by at most one centavo after rounding. */
const AMOUNT_TOLERANCE_PHP = 0.01;

export function fundingPaidAmountMatchesSession(
  paidAmount: number,
  sessionGross: Prisma.Decimal,
): boolean {
  const expected = Number(sessionGross.toString());
  return Math.abs(paidAmount - expected) <= AMOUNT_TOLERANCE_PHP;
}

function paidAmountFromInvoice(invoice: {
  paidAmount?: number;
  amount: number;
}): number {
  return invoice.paidAmount ?? invoice.amount;
}

/**
 * Re-fetch invoice from Xendit and confirm PAID + matching external_id before crediting.
 */
export async function verifyFundingInvoiceWebhook(
  webhook: NormalizedXenditInvoiceWebhook,
): Promise<{ invoiceId: string; amount: number } | null> {
  if (!env.XENDIT_SECRET_KEY?.trim()) {
    logger.warn("Funding webhook ignored: XENDIT_SECRET_KEY not set", {
      externalId: webhook.externalId,
    });
    return null;
  }

  let invoice;
  try {
    invoice = await getXenditInvoice(webhook.invoiceId);
  } catch (err) {
    logger.warn("Funding webhook ignored: could not verify invoice with Xendit", {
      externalId: webhook.externalId,
      invoiceId: webhook.invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (invoice.externalId !== webhook.externalId) {
    logger.warn("Funding webhook ignored: external_id mismatch", {
      webhookExternalId: webhook.externalId,
      xenditExternalId: invoice.externalId,
      invoiceId: invoice.id,
    });
    return null;
  }

  if (invoice.status.toUpperCase() !== "PAID") {
    logger.warn("Funding webhook ignored: invoice not PAID at Xendit", {
      externalId: webhook.externalId,
      invoiceId: invoice.id,
      status: invoice.status,
    });
    return null;
  }

  return { invoiceId: invoice.id, amount: paidAmountFromInvoice(invoice) };
}

/**
 * Re-fetch payout from Xendit and confirm reference id + terminal status (dev payouts skip API).
 */
export async function verifyPayoutWebhook(
  webhook: NormalizedXenditPayoutWebhook,
): Promise<XenditPayoutSnapshot | null> {
  if (isDevXenditPayoutId(webhook.payoutId)) {
    return {
      id: webhook.payoutId,
      referenceId: webhook.referenceId,
      status: webhook.status,
      feeAmount: webhook.feeAmount,
      failureReason: webhook.failureReason,
    };
  }

  if (!env.XENDIT_SECRET_KEY?.trim()) {
    logger.warn("Payout webhook ignored: XENDIT_SECRET_KEY not set", {
      payoutId: webhook.payoutId,
      referenceId: webhook.referenceId,
    });
    return null;
  }

  let payout;
  try {
    payout = await getXenditPayout(webhook.payoutId);
  } catch (err) {
    logger.warn("Payout webhook ignored: could not verify payout with Xendit", {
      payoutId: webhook.payoutId,
      referenceId: webhook.referenceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (payout.id !== webhook.payoutId) {
    logger.warn("Payout webhook ignored: payout id mismatch", {
      webhookPayoutId: webhook.payoutId,
      xenditPayoutId: payout.id,
    });
    return null;
  }

  if (payout.referenceId !== webhook.referenceId) {
    logger.warn("Payout webhook ignored: reference_id mismatch", {
      webhookReferenceId: webhook.referenceId,
      xenditReferenceId: payout.referenceId,
      payoutId: payout.id,
    });
    return null;
  }

  const webhookSuccess = isXenditPayoutSuccess(webhook.status);
  const webhookFailed = isXenditPayoutFailed(webhook.status);
  const apiSuccess = isXenditPayoutSuccess(payout.status);
  const apiFailed = isXenditPayoutFailed(payout.status);

  if (webhookSuccess && !apiSuccess) {
    logger.warn("Payout webhook ignored: webhook success but Xendit status not terminal success", {
      payoutId: payout.id,
      xenditStatus: payout.status,
    });
    return null;
  }

  if (webhookFailed && !apiFailed) {
    logger.warn("Payout webhook ignored: webhook failed but Xendit status not terminal failure", {
      payoutId: payout.id,
      xenditStatus: payout.status,
    });
    return null;
  }

  if (!apiSuccess && !apiFailed) {
    logger.info("Payout webhook ignored: payout not in terminal state at Xendit", {
      payoutId: payout.id,
      xenditStatus: payout.status,
    });
    return null;
  }

  return payout;
}
