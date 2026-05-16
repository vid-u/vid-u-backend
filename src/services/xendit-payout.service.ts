import type { PaymentMethod } from "../generated/prisma/client.js";
import { decryptSecret } from "../lib/crypto.js";
import { xenditCreatePayout } from "../lib/xenditClient.js";
import { channelLimits } from "../config/xendit_channel_limits.js";
import { ValidationError } from "../utils/errors.js";

export const BRAND_REFUND_LEDGER_NOTE = "brand_refund";

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
