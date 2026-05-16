import type { PayoutPurpose, PaymentMethod } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

export type PaymentMethodForPayout = PaymentMethod & { accountNumber: string };

export async function getDefaultPaymentMethodForPayout(
  userId: string,
  purpose: PayoutPurpose,
): Promise<PaymentMethodForPayout> {
  const row = await prisma.paymentMethod.findFirst({
    where: { userId, purpose, isDefault: true },
  });
  if (!row) {
    throw new ConflictError("payment_method_required");
  }
  return {
    ...row,
    accountNumber: decryptSecret(row.accountNumberEncrypted),
  };
}

export async function getPaymentMethodForPayout(
  userId: string,
  purpose: PayoutPurpose,
  methodId: string,
): Promise<PaymentMethodForPayout> {
  const row = await prisma.paymentMethod.findFirst({
    where: { id: methodId, userId, purpose },
  });
  if (!row) {
    throw new NotFoundError("Payment method not found");
  }
  return {
    ...row,
    accountNumber: decryptSecret(row.accountNumberEncrypted),
  };
}
