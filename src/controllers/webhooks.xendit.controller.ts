import type { Request, Response } from "express";
import { env } from "../lib/env.js";
import { sendSuccess } from "../utils/api-response.js";
import { ForbiddenError } from "../utils/errors.js";
import * as xenditWebhook from "../services/xendit-webhook.service.js";

function verifyXenditWebhook(req: Request): void {
  if (!env.XENDIT_WEBHOOK_TOKEN) {
    if (env.NODE_ENV === "production") {
      throw new ForbiddenError("XENDIT_WEBHOOK_TOKEN not configured");
    }
    return;
  }
  const token = req.headers["x-callback-token"];
  if (token !== env.XENDIT_WEBHOOK_TOKEN) {
    throw new ForbiddenError("Invalid webhook token");
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

/**
 * Xendit invoice + payout callbacks (single route; branch on payload `status` / type).
 */
export async function postXenditWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  verifyXenditWebhook(req);
  const body = req.body as Record<string, unknown>;
  const externalId =
    typeof body.external_id === "string" ? body.external_id : undefined;
  const status = typeof body.status === "string" ? body.status : undefined;
  const entityId = typeof body.id === "string" ? body.id : undefined;
  const amount =
    typeof body.paid_amount === "number"
      ? body.paid_amount
      : typeof body.amount === "number"
        ? body.amount
        : undefined;
  const referenceId =
    typeof body.reference_id === "string" ? body.reference_id : undefined;

  const isFundingInvoice = Boolean(externalId?.startsWith("fund_"));

  if (
    isFundingInvoice &&
    status === "PAID" &&
    entityId &&
    amount !== undefined &&
    externalId
  ) {
    await xenditWebhook.applyFundingInvoicePaid({
      externalId,
      invoiceId: entityId,
      amount,
    });
  } else if (
    !isFundingInvoice &&
    entityId &&
    status &&
    referenceId &&
    isUuid(referenceId)
  ) {
    await xenditWebhook.dispatchPayoutWebhook({
      payoutId: entityId,
      status,
      referenceId,
      failureReason:
        typeof body.failure_code === "string"
          ? body.failure_code
          : typeof body.reason === "string"
            ? body.reason
            : "payout_failed",
      feeAmount: typeof body.fee_amount === "number" ? body.fee_amount : 0,
    });
  }

  sendSuccess(res, { received: true });
}
