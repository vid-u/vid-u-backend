import { prisma } from "../lib/prisma.js";

/** Throws if the database is unreachable (used by readiness probes). */
export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
