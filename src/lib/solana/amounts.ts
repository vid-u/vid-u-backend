import BN from "bn.js";
import { Prisma } from "../../generated/prisma/client.js";

/** USDC human amount → raw u64 (6 decimals), as used on-chain. */
export function usdcToRawAmount(usdc: Prisma.Decimal | number | string): BN {
  const dec =
    usdc instanceof Prisma.Decimal
      ? usdc
      : new Prisma.Decimal(typeof usdc === "number" ? String(usdc) : usdc);
  const s = dec.times(1_000_000).toFixed(0, Prisma.Decimal.ROUND_HALF_UP);
  return new BN(s, 10);
}
