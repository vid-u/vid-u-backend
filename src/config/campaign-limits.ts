import { readEnvInt, readEnvMoney } from "./read-env.js";

/** Minimum gross PHP per 1k views a brand may set (create / patch). */
export const MIN_BRAND_RATE_PER_1K = readEnvInt("MIN_BRAND_RATE_PER_1K", 35);

/** Minimum ₱ the brand pays to fund / publish (create, checkout). Override: `MIN_PUBLISH_PHP`. */
export const MIN_PUBLISH_PHP = readEnvMoney("MIN_PUBLISH_PHP", 10_000);
