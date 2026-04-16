/**
 * Default legal/process copy applied server-side on campaign creation.
 * Clients do not submit these fields on `POST /client/campaigns/create`.
 */

export const BUGHYVE_STANDARD_DISCLOSURE_GUIDELINES = [
  "## Coordinated disclosure",
  "Report vulnerabilities only through BugHyve for this campaign. Do not publicly disclose issues, share exploit code, or discuss findings outside the platform until the client has resolved or explicitly approved disclosure.",
  "",
  "## Scope of testing",
  "Test only assets and flows listed in the campaign scope. Stop immediately if you believe your actions could harm users, violate law, or impact systems outside scope.",
  "",
  "## Data handling",
  "Use the minimum data necessary to demonstrate an issue. Do not exfiltrate, store, or share personal or production customer data. If you encounter sensitive data, stop and report through BugHyve only.",
].join("\n");

export const BUGHYVE_STANDARD_REWARD_ELIGIBILITY = [
  "## Eligibility",
  "Rewards apply to the first valid, in-scope submission per issue according to campaign rules. Duplicate reports, out-of-scope issues, or submissions that do not follow instructions may be declined.",
  "",
  "## Review and payout",
  "The client reviews submissions within the campaign review window. Approved payouts are based on the published severity tiers and available campaign budget. BugHyve facilitates the process; final reward decisions rest with the client within these guidelines.",
].join("\n");
