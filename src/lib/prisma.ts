import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

type Decimalish = Prisma.Decimal | { toString(): string };

/** Prisma `Decimal` (and similar) → string for JSON. */
export function dec(d: Decimalish | null | undefined): string | null {
  if (d == null) return null;
  return d.toString();
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrisma(): PrismaClient {
  const adapter = new PrismaPg(env.DATABASE_URL);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}
