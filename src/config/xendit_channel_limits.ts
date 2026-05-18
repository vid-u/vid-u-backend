/**
 * Per-channel max for **creator_net** (PHP), per Xendit payout limits.
 * Used at submit time to cap funded views when earnings exceed channel max.
 */
export const XENDIT_CHANNEL_LIMITS: Record<string, { max: number }> = {
  PH_GCASH: { max: 500_000 },
  PH_MAYA: { max: 50_000 },
  PH_GRABPAY: { max: 50_000 },
  PH_SHOPEEPAY: { max: 50_000 },
  PH_BDO: { max: 50_000 },
  PH_BPI: { max: 50_000 },
};

export function getChannelLimits(channelCode: string): { max: number } | null {
  return XENDIT_CHANNEL_LIMITS[channelCode] ?? null;
}

/** Alias for call sites expecting `channelLimits(code)`. */
export function channelLimits(channelCode: string): { max: number } | null {
  return getChannelLimits(channelCode);
}
