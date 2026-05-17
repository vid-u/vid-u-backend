import type { Request, Response } from "express";
import { env } from "../lib/env.js";
import { sendSuccess } from "../utils/api-response.js";
import { ForbiddenError } from "../utils/errors.js";
import {
  parseXenditInvoiceWebhook,
  parseXenditPayoutWebhook,
} from "../services/xendit-webhook-payload.js";
import * as xenditWebhook from "../services/xendit-webhook.service.js";
import { logger } from "../utils/logger.js";

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
 * Xendit invoice + payout callbacks (single route; supports flat v2 and `event` + `data` v3).
 */
export async function postXenditWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  verifyXenditWebhook(req);
  const body = req.body as Record<string, unknown>;
  const event = typeof body.event === "string" ? body.event : undefined;

  const invoice = parseXenditInvoiceWebhook(body);
  if (invoice) {
    await xenditWebhook.handleFundingInvoiceWebhook(invoice);
    sendSuccess(res, { received: true });
    return;
  }

  const payout = parseXenditPayoutWebhook(body);
  if (payout && isUuid(payout.referenceId)) {
    await xenditWebhook.handlePayoutWebhook(payout);
    sendSuccess(res, { received: true });
    return;
  }

  if (event?.toLowerCase().startsWith("payout.")) {
    logger.warn("Xendit payout webhook ignored — could not parse payload", {
      event,
      referenceId:
        typeof body.reference_id === "string"
          ? body.reference_id
          : typeof (body.data as Record<string, unknown> | undefined)?.reference_id ===
              "string"
            ? (body.data as Record<string, unknown>).reference_id
            : undefined,
    });
  }

  sendSuccess(res, { received: true });
}
