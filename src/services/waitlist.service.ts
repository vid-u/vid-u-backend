import { prisma } from "../lib/prisma.js";
import type { WaitlistDto } from "../validation/waitlist.schema.js";

export async function getWaitlistCounts(): Promise<{
  brand: number;
  creator: number;
}> {
  const groups = await prisma.waitlist.groupBy({
    by: ["role"],
    _count: { _all: true },
  });
  const out = { brand: 0, creator: 0 };
  for (const g of groups) {
    const n = g._count._all;
    if (g.role === "brand") out.brand = n;
    if (g.role === "creator") out.creator = n;
  }
  return out;
}

export type WaitlistSignupResult = {
  alreadyWhitelisted: boolean;
  id: string;
  createdAt: Date;
};

export async function addToWaitlist(input: WaitlistDto): Promise<WaitlistSignupResult> {
  const email = input.email.toLowerCase();

  const existing = await prisma.waitlist.findUnique({ where: { email } });
  if (existing) {
    return {
      alreadyWhitelisted: true,
      id: existing.id,
      createdAt: existing.createdAt,
    };
  }

  try {
    const row = await prisma.waitlist.create({
      data: {
        email,
        role: input.role,
        notes: input.notes,
      },
    });
    return {
      alreadyWhitelisted: false,
      id: row.id,
      createdAt: row.createdAt,
    };
  } catch (e: unknown) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      const lostRace = await prisma.waitlist.findUnique({ where: { email } });
      if (lostRace) {
        return {
          alreadyWhitelisted: true,
          id: lostRace.id,
          createdAt: lostRace.createdAt,
        };
      }
    }
    throw e;
  }
}
