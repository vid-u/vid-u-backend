import type { PaymentMethod } from "../generated/prisma/client.js";
import { env } from "../lib/env.js";
import { decryptSecret } from "../lib/crypto.js";
import { xenditCreatePayout } from "../lib/xenditClient.js";
import { channelLimits } from "../config/xendit_channel_limits.js";
import { AppError, ValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const BRAND_REFUND_LEDGER_NOTE = "brand_refund";

const PAYMENT_UNAVAILABLE =
  "We could not reach the payment provider. Try again in a moment.";

export type XenditPayoutSnapshot = {
  id: string;
  referenceId: string;
  status: string;
  feeAmount: number;
  failureReason: string;
};

export function isDevXenditPayoutId(payoutId: string): boolean {
  return payoutId.startsWith("dev_");
}

export function isXenditPayoutSuccess(status: string): boolean {
  const s = status.toUpperCase();
  return s === "SUCCEEDED" || s === "COMPLETED";
}

export function isXenditPayoutFailed(status: string): boolean {
  const s = status.toUpperCase();
  return (
    s === "FAILED" ||
    s === "CANCELLED" ||
    s === "REVERSED" ||
    s === "COMPLIANCE_REJECTED"
  );
}

function xenditAuthHeader(): string {
  if (!env.XENDIT_SECRET_KEY?.trim()) {
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }
  return `Basic ${Buffer.from(`${env.XENDIT_SECRET_KEY}:`).toString("base64")}`;
}

function parsePayoutFee(payload: Record<string, unknown>): number {
  if (typeof payload.fee_amount === "number") return payload.fee_amount;
  const fees = payload.fees;
  if (fees && typeof fees === "object" && !Array.isArray(fees)) {
    const xenditFee = (fees as Record<string, unknown>).xendit_fee;
    if (typeof xenditFee === "number") return xenditFee;
  }
  return 0;
}

function parsePayoutRow(data: Record<string, unknown>): XenditPayoutSnapshot {
  const id = typeof data.id === "string" ? data.id : undefined;
  const referenceId =
    typeof data.reference_id === "string" ? data.reference_id : undefined;
  const status = typeof data.status === "string" ? data.status : undefined;
  if (!id || !referenceId || !status) {
    throw new Error("Xendit payout: missing id, reference_id, or status");
  }
  const failureReason =
    typeof data.failure_code === "string"
      ? data.failure_code
      : typeof data.reason === "string"
        ? data.reason
        : "payout_failed";
  return {
    id,
    referenceId,
    status,
    feeAmount: parsePayoutFee(data),
    failureReason,
  };
}

/** Fetches payout state from Xendit (webhook verification). */
export async function getXenditPayout(payoutId: string): Promise<XenditPayoutSnapshot> {
  const auth = xenditAuthHeader();
  const res = await fetch(`https://api.xendit.co/v2/payouts/${encodeURIComponent(payoutId)}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn("Xendit get payout failed", {
      payoutId,
      status: res.status,
      body: text.slice(0, 1000),
    });
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return parsePayoutRow(data);
}

export function buildXenditChannelProperties(pm: PaymentMethod, accountNumber: string): Record<string, string> {
  const props: Record<string, string> = {
    account_number: accountNumber,
    account_holder_name: pm.accountName,
  };
  if (pm.kind === "bank" && pm.bankName) {
    props.bank_name = pm.bankName;
  }
  return props;
}

export function validatePayoutAmount(channelCode: string, amountPhp: number): void {
  const limits = channelLimits(channelCode);
  if (!limits) {
    throw new ValidationError("Unsupported payout channel");
  }
  if (amountPhp < limits.min) {
    throw new ValidationError("below_minimum_payout");
  }
  if (amountPhp > limits.max) {
    throw new ValidationError("above_maximum_payout");
  }
}

export async function createXenditDisbursement(input: {
  idempotencyKey: string;
  referenceId: string;
  paymentMethod: PaymentMethod;
  amountNetPhp: number;
  description: string;
}): Promise<{ payoutId: string }> {
  const accountNumber = decryptSecret(input.paymentMethod.accountNumberEncrypted);
  validatePayoutAmount(input.paymentMethod.xenditChannelCode, input.amountNetPhp);

  const channelProperties = buildXenditChannelProperties(input.paymentMethod, accountNumber);
  const amount = Math.round(input.amountNetPhp * 100) / 100;

  const { id } = await xenditCreatePayout({
    idempotencyKey: input.idempotencyKey,
    referenceId: input.referenceId,
    channelCode: input.paymentMethod.xenditChannelCode,
    channelProperties,
    amount,
    currency: "PHP",
  });

  return { payoutId: id };
}
