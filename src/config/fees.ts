import { readEnvMoney, readEnvPercent } from "./read-env.js";

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

/** Remaining pool (gross, post-fee view) below this auto-pauses the campaign. */
export const MIN_PUBLISH_FLOOR_PHP = readEnvMoney("MIN_PUBLISH_FLOOR_PHP", 10_000);
