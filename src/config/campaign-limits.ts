import { readEnvInt } from "./read-env.js";

/** Minimum gross PHP per 1k views a brand may set (create / patch). */
export const MIN_BRAND_RATE_PER_1K = readEnvInt("MIN_BRAND_RATE_PER_1K", 35);

/** Minimum planned gross budget (PHP) when creating a campaign. */
export const MIN_GROSS_PUBLISH_PHP = readEnvInt("MIN_GROSS_PUBLISH_PHP", 10_000);
