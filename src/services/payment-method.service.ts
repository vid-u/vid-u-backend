import type { ClientPaymentMethod } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import type { AddPaymentMethodDto } from "../validation/payment-method.schema.js";

function toRow(m: ClientPaymentMethod) {
  return {
    id: m.id,
    walletAddress: m.walletAddress,
    label: m.label,
    isPrimary: m.isPrimary,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * List in **insertion order** (oldest first) so changing the primary does not reorder the UI.
 * Use `isPrimary` on each row to show which is default.
 */
export async function listPaymentMethods(userId: string) {
  const rows = await prisma.clientPaymentMethod.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return { paymentMethods: rows.map(toRow) };
}

/**
 * On first use, ensure the user has a primary payment method matching their account wallet
 * (`users.wallet_address` at sync time). Idempotent: no-op if they already have any saved method.
 */
export async function ensureInitialPrimaryPaymentMethod(
  userId: string,
  walletAddress: string,
) {
  const normalized = walletAddress.trim();
  if (!normalized) return;

  const count = await prisma.clientPaymentMethod.count({ where: { userId } });
  if (count > 0) return;

  await prisma.clientPaymentMethod.create({
    data: {
      userId,
      walletAddress: normalized,
      label: null,
      isPrimary: true,
    },
  });
}

export async function addPaymentMethod(
  userId: string,
  input: AddPaymentMethodDto,
) {
  const walletAddress = input.walletAddress.trim();

  const duplicate = await prisma.clientPaymentMethod.findFirst({
    where: { userId, walletAddress },
  });
  if (duplicate) {
    throw new ConflictError("This wallet is already saved");
  }

  const count = await prisma.clientPaymentMethod.count({ where: { userId } });
  const isPrimary = count === 0;

  const created = await prisma.clientPaymentMethod.create({
    data: {
      userId,
      walletAddress,
      label: input.label?.trim() ? input.label.trim() : null,
      isPrimary,
    },
  });

  return { paymentMethod: toRow(created) };
}

export async function setDefaultPaymentMethod(
  userId: string,
  paymentMethodId: string,
) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.clientPaymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });
    if (!target) {
      throw new NotFoundError("Payment method not found");
    }
    if (target.isPrimary) {
      return;
    }
    await tx.clientPaymentMethod.updateMany({
      where: { userId },
      data: { isPrimary: false },
    });
    await tx.clientPaymentMethod.update({
      where: { id: paymentMethodId },
      data: { isPrimary: true },
    });
  });
  return listPaymentMethods(userId);
}

export async function deletePaymentMethod(
  userId: string,
  paymentMethodId: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletAddress: true },
  });
  const signInWallet = user?.walletAddress?.trim() ?? "";

  await prisma.$transaction(async (tx) => {
    const row = await tx.clientPaymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });
    if (!row) {
      throw new NotFoundError("Payment method not found");
    }

    if (signInWallet && row.walletAddress.trim() === signInWallet) {
      throw new ValidationError(
        "Cannot remove the payment method used for sign-in.",
      );
    }

    await tx.clientPaymentMethod.delete({ where: { id: paymentMethodId } });

    if (row.isPrimary) {
      const next = await tx.clientPaymentMethod.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await tx.clientPaymentMethod.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }
  });
}
