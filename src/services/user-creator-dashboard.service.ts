import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export type CreatorDashboardStats = {
  lifetimeEarnings: string;
  totalVerifiedViews: string;
  allSubmissions: number;
  pendingSubmissions: number;
  submissionCounts: {
    all: number;
    pending: number;
    paid: number;
    rejected: number;
  };
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

/** Headline stats for creator dashboard / submissions (paid-only earnings & views). */
export async function getCreatorDashboardStats(
  creatorUserId: string,
): Promise<CreatorDashboardStats> {
  const rows = await prisma.$queryRaw<
    Array<{
      all_submissions: number;
      pending_submissions: number;
      paid_submissions: number;
      rejected_submissions: number;
      lifetime_earnings: unknown;
      total_verified_views: unknown;
    }>
  >`
    SELECT
      COUNT(*)::int AS all_submissions,
      COUNT(*) FILTER (WHERE s.status::text IN ('pending', 'paying'))::int AS pending_submissions,
      COUNT(*) FILTER (WHERE s.status::text = 'paid')::int AS paid_submissions,
      COUNT(*) FILTER (WHERE s.status::text IN ('rejected', 'payout_failed'))::int AS rejected_submissions,
      COALESCE(SUM(s.creator_net) FILTER (WHERE s.status::text = 'paid'), 0) AS lifetime_earnings,
      COALESCE(SUM(s.funded_views) FILTER (WHERE s.status::text = 'paid'), 0) AS total_verified_views
    FROM submission s
    WHERE s.creator_user_id = ${creatorUserId}::uuid
  `;

  const row = rows[0] ?? {
    all_submissions: 0,
    pending_submissions: 0,
    paid_submissions: 0,
    rejected_submissions: 0,
    lifetime_earnings: 0,
    total_verified_views: 0n,
  };

  const all = row.all_submissions ?? 0;
  const pending = row.pending_submissions ?? 0;
  const paid = row.paid_submissions ?? 0;
  const rejected = row.rejected_submissions ?? 0;

  return {
    lifetimeEarnings: dec(row.lifetime_earnings),
    totalVerifiedViews: bigintStr(row.total_verified_views),
    allSubmissions: all,
    pendingSubmissions: pending,
    submissionCounts: {
      all,
      pending,
      paid,
      rejected,
    },
  };
}
