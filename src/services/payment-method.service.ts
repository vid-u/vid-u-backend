import type { ClientPaymentMethod } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
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

export async function listPaymentMethods(userId: string) {
  const rows = await prisma.clientPaymentMethod.findMany({
    where: { userId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return { paymentMethods: rows.map(toRow) };
}

export async function addPaymentMethod(userId: string, input: AddPaymentMethodDto) {
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

export async function deletePaymentMethod(userId: string, paymentMethodId: string) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.clientPaymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });
    if (!row) {
      throw new NotFoundError("Payment method not found");
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
