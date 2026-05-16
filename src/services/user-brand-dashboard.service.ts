import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export type BrandDashboardStats = {
  totalCampaigns: number;
  totalReached: string;
  totalSpent: string;
  avgCostPerView: string | null;
};

function dec(v: unknown): string {
  if (v == null) return "0.00";
  if (v instanceof Prisma.Decimal) return v.toFixed(2);
  return new Prisma.Decimal(String(v)).toFixed(2);
}

function bigintStr(v: unknown): string {
  if (v == null) return "0";
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

/** Headline stats for the brand dashboard (non-rejected submissions on this brand's campaigns). */
export async function getBrandDashboardStats(brandUserId: string): Promise<BrandDashboardStats> {
  const rows = await prisma.$queryRaw<
    Array<{
      total_campaigns: number;
      total_reached: unknown;
      total_spent: unknown;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM campaign WHERE brand_user_id = ${brandUserId}::uuid) AS total_campaigns,
      COALESCE(SUM(s.funded_views), 0) AS total_reached,
      COALESCE(SUM(s.gross_amount), 0) AS total_spent
    FROM submission s
    INNER JOIN campaign c ON c.id = s.campaign_id
    WHERE c.brand_user_id = ${brandUserId}::uuid
      AND s.status::text <> 'rejected'
  `;

  const row = rows[0] ?? { total_campaigns: 0, total_reached: 0n, total_spent: 0 };
  const totalReached = bigintStr(row.total_reached);
  const totalSpent = dec(row.total_spent);
  const reachedN = BigInt(totalReached);
  const avgCostPerView =
    reachedN > 0n
      ? new Prisma.Decimal(totalSpent).div(reachedN.toString()).toFixed(6)
      : null;

  return {
    totalCampaigns: row.total_campaigns ?? 0,
    totalReached,
    totalSpent,
    avgCostPerView,
  };
}
