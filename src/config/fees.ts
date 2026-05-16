import { readEnvPercent } from "./read-env.js";

import { MIN_PUBLISH_PHP } from "./campaign-limits.js";

/** VidU's cut of every brand deposit (gross). */
export const PLATFORM_DEPOSIT_FEE_PERCENT = readEnvPercent(
  "PLATFORM_DEPOSIT_FEE_PERCENT",
  0.15,
);

/** VidU's cut of every creator payout (gross performance). Creator share = 1 − this. */
export const CREATOR_PAYOUT_FEE_PERCENT = readEnvPercent(
  "CREATOR_PAYOUT_FEE_PERCENT",
  0.2,
);

export const CREATOR_PAYOUT_SHARE = 1 - CREATOR_PAYOUT_FEE_PERCENT;

/**
 * Net spendable pool floor: same minimum publish deposit (`MIN_PUBLISH_PHP`) after deposit fee.
 * Compared against API `availableBudget` (net).
 */
export const MIN_PUBLISH_SPENDABLE_FLOOR_PHP =
  MIN_PUBLISH_PHP * (1 - PLATFORM_DEPOSIT_FEE_PERCENT);
