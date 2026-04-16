import { UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import type { SyncUserInput } from "../types/auth.types.js";
import { ConflictError } from "../utils/errors.js";

export async function syncUserFromSession(
  input: SyncUserInput,
): Promise<{
  user: { id: string; walletAddress: string; role: UserRole };
}> {
  const role = input.role ?? UserRole.tester;

  const walletTaken = await prisma.user.findUnique({
    where: { walletAddress: input.walletAddress },
  });
  if (walletTaken && walletTaken.id !== input.authUserId) {
    throw new ConflictError(
      "Wallet address is already linked to another account"
    );
  }

  const user = await prisma.user.upsert({
    where: { id: input.authUserId },
    create: {
      id: input.authUserId,
      walletAddress: input.walletAddress,
      role,
    },
    update: {
      walletAddress: input.walletAddress,
      ...(input.role !== undefined ? { role: input.role } : {}),
    },
  });

  return {
    user: {
      id: user.id,
      walletAddress: user.walletAddress,
      role: user.role,
    },
  };
}
