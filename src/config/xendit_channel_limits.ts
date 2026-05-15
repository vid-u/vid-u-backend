/**
 * Per-channel min/max for **creator_net** (PHP), per Xendit payout limits.
 * Used at submit time to cap funded views and reject below-min payouts.
 */
export const XENDIT_CHANNEL_LIMITS: Record<string, { min: number; max: number }> = {
  PH_GCASH: { min: 100, max: 500_000 },
  PH_MAYA: { min: 100, max: 50_000 },
  PH_GRABPAY: { min: 100, max: 50_000 },
  PH_SHOPEEPAY: { min: 100, max: 50_000 },
  PH_BDO: { min: 100, max: 50_000 },
  PH_BPI: { min: 100, max: 50_000 },
};

export function getChannelLimits(channelCode: string): { min: number; max: number } | null {
  return XENDIT_CHANNEL_LIMITS[channelCode] ?? null;
}

/** Alias for call sites expecting `channelLimits(code)`. */
export function channelLimits(channelCode: string): { min: number; max: number } | null {
  return getChannelLimits(channelCode);
}
