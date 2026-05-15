import type { PayoutPurpose, PaymentMethodKind } from "../generated/prisma/enums.js";
import type { PaymentMethod, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { encryptSecret } from "../lib/crypto.js";
import { channelLimits } from "../config/xendit_channel_limits.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import type { PatchPaymentMethodBodyDto, PostPaymentMethodBodyDto } from "../validation/payment-methods.schema.js";

const BANK_CHANNEL_CODES = new Set(["PH_BDO", "PH_BPI"]);

function kindFromChannelCode(code: string): PaymentMethodKind {
  return BANK_CHANNEL_CODES.has(code) ? "bank" : "e_wallet";
}

function digitsOnly(accountNumber: string): string {
  return accountNumber.replace(/\D/g, "");
}

export function purposeFromUserRole(role: "brand" | "creator"): PayoutPurpose {
  return role === "brand" ? "brand_refund" : "creator_payout";
}

export function toPaymentMethodPublic(row: PaymentMethod) {
  return {
    id: row.id,
    purpose: row.purpose,
    kind: row.kind,
    xenditChannelCode: row.xenditChannelCode,
    label: row.label,
    bankName: row.bankName,
    lastFour: row.lastFour,
    accountName: row.accountName,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Guarantees exactly one `isDefault: true` when at least one method exists (deterministic: oldest row wins ties). */
async function ensureSingleDefault(
  tx: Prisma.TransactionClient,
  userId: string,
  purpose: PayoutPurpose,
): Promise<void> {
  const rows = await tx.paymentMethod.findMany({
    where: { userId, purpose },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return;

  const defaults = rows.filter((r) => r.isDefault);
  if (defaults.length === 0) {
    await tx.paymentMethod.updateMany({ where: { userId, purpose }, data: { isDefault: false } });
    await tx.paymentMethod.update({ where: { id: rows[0]!.id }, data: { isDefault: true } });
    return;
  }
  if (defaults.length > 1) {
    const keep = defaults[0]!;
    await tx.paymentMethod.updateMany({
      where: { userId, purpose, id: { not: keep.id } },
      data: { isDefault: false },
    });
    await tx.paymentMethod.update({ where: { id: keep.id }, data: { isDefault: true } });
  }
}

export async function listPaymentMethodsForUser(
  userId: string,
  purpose: PayoutPurpose,
): Promise<ReturnType<typeof toPaymentMethodPublic>[]> {
  const rows = await prisma.paymentMethod.findMany({
    where: { userId, purpose },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  return rows.map(toPaymentMethodPublic);
}

export async function createPaymentMethodForUser(
  userId: string,
  purpose: PayoutPurpose,
  body: PostPaymentMethodBodyDto,
): Promise<ReturnType<typeof toPaymentMethodPublic>> {
  if (!channelLimits(body.xenditChannelCode)) {
    throw new ValidationError("Unsupported xenditChannelCode");
  }
  const kind = kindFromChannelCode(body.xenditChannelCode);
  if (kind === "bank" && body.bankName === undefined) {
    throw new ValidationError("bankName is required for bank payout channels");
  }
  if (kind === "e_wallet" && body.bankName !== undefined) {
    throw new ValidationError("bankName must not be set for e-wallet channels");
  }

  const digits = digitsOnly(body.accountNumber);
  if (digits.length < 4) {
    throw new ValidationError("accountNumber must contain at least 4 digits");
  }
  const lastFour = digits.slice(-4);
  const accountNumberEncrypted = encryptSecret(digits);

  return prisma.$transaction(async (tx) => {
    const existingCount = await tx.paymentMethod.count({ where: { userId, purpose } });
    const firstMethod = existingCount === 0;
    const userRequestedDefault = body.isDefault === true;
    const shouldBeDefault = firstMethod || userRequestedDefault;

    if (shouldBeDefault) {
      await tx.paymentMethod.updateMany({
        where: { userId, purpose },
        data: { isDefault: false },
      });
    }

    const row = await tx.paymentMethod.create({
      data: {
        userId,
        purpose,
        kind,
        xenditChannelCode: body.xenditChannelCode,
        label: body.label,
        bankName: body.bankName ?? null,
        lastFour,
        accountNumberEncrypted,
        accountName: body.accountName,
        isDefault: shouldBeDefault,
      },
    });

    await ensureSingleDefault(tx, userId, purpose);
    const finalRow = await tx.paymentMethod.findUniqueOrThrow({ where: { id: row.id } });
    return toPaymentMethodPublic(finalRow);
  });
}

export async function patchPaymentMethodForUser(
  userId: string,
  purpose: PayoutPurpose,
  methodId: string,
  body: PatchPaymentMethodBodyDto,
): Promise<ReturnType<typeof toPaymentMethodPublic>> {
  const existing = await prisma.paymentMethod.findFirst({
    where: { id: methodId, userId, purpose },
  });
  if (!existing) {
    throw new NotFoundError("Payment method not found");
  }

  return prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.paymentMethod.updateMany({
        where: { userId, purpose },
        data: { isDefault: false },
      });
    }

    await tx.paymentMethod.update({
      where: { id: methodId },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.bankName !== undefined ? { bankName: body.bankName } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      },
    });

    await ensureSingleDefault(tx, userId, purpose);
    const row = await tx.paymentMethod.findUniqueOrThrow({ where: { id: methodId } });
    return toPaymentMethodPublic(row);
  });
}

export async function deletePaymentMethodForUser(
  userId: string,
  purpose: PayoutPurpose,
  methodId: string,
): Promise<void> {
  const existing = await prisma.paymentMethod.findFirst({
    where: { id: methodId, userId, purpose },
  });
  if (!existing) {
    throw new NotFoundError("Payment method not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.delete({ where: { id: methodId } });
    await ensureSingleDefault(tx, userId, purpose);
  });
}
