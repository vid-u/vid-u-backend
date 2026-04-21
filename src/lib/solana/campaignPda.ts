import { getProgramId } from "./config.js";
import { campaignPda } from "./pdas.js";

/** Campaign escrow account PDA base58 (`["campaign", campaign_id_bytes]`). */
export function deriveCampaignEscrowPdaBase58(campaignIdUuid: string): string {
  return campaignPda(getProgramId(), campaignIdUuid).toBase58();
}
