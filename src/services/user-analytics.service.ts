import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export type CreatorPeriodRow = { period: string; earnings: string };

export type BrandPeriodRow = {
  period: string;
  deposits: string;
  spend: string;
};

function dec(v: unknown): string {
  if (v == null) return "0.00";
  if (v instanceof Prisma.Decimal) return v.toFixed(2);
  return new Prisma.Decimal(String(v)).toFixed(2);
}

/** Paid submissions: sum `creator_net` by calendar month (UTC), most recent first. */
export async function getCreatorEarningsByMonth(userId: string): Promise<CreatorPeriodRow[]> {
  const rows = await prisma.$queryRaw<Array<{ period: string; earnings: unknown }>>`
    SELECT to_char(date_trunc('month', s.paid_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS period,
      COALESCE(SUM(s.creator_net), 0) AS earnings
    FROM submission s
    WHERE s.creator_user_id = ${userId}::uuid
      AND s.status = 'paid'
      AND s.paid_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 24
  `;
  return rows.map((r) => ({ period: r.period, earnings: dec(r.earnings) }));
}

export async function getCreatorEarningsByYear(userId: string): Promise<CreatorPeriodRow[]> {
  const rows = await prisma.$queryRaw<Array<{ period: string; earnings: unknown }>>`
    SELECT to_char(date_trunc('year', s.paid_at AT TIME ZONE 'UTC'), 'YYYY') AS period,
      COALESCE(SUM(s.creator_net), 0) AS earnings
    FROM submission s
    WHERE s.creator_user_id = ${userId}::uuid
      AND s.status = 'paid'
      AND s.paid_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 10
  `;
  return rows.map((r) => ({ period: r.period, earnings: dec(r.earnings) }));
}

/** Ledger-backed deposits vs release spend for this brand's campaigns (UTC months). */
export async function getBrandLedgerByMonth(userId: string): Promise<BrandPeriodRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ period: string; deposits: unknown; spend: unknown }>
  >`
    SELECT to_char(date_trunc('month', le.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS period,
      COALESCE(SUM(CASE WHEN le.ledger_type::text = 'deposit'
        THEN le.amount_gross ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN le.ledger_type::text = 'release'
        THEN le.amount_gross ELSE 0 END), 0) AS spend
    FROM ledger_entry le
    INNER JOIN campaign c ON c.id = le.campaign_id
    WHERE c.brand_user_id = ${userId}::uuid
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 24
  `;
  return rows.map((r) => ({
    period: r.period,
    deposits: dec(r.deposits),
    spend: dec(r.spend),
  }));
}

export async function getBrandLedgerByYear(userId: string): Promise<BrandPeriodRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ period: string; deposits: unknown; spend: unknown }>
  >`
    SELECT to_char(date_trunc('year', le.created_at AT TIME ZONE 'UTC'), 'YYYY') AS period,
      COALESCE(SUM(CASE WHEN le.ledger_type::text = 'deposit'
        THEN le.amount_gross ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN le.ledger_type::text = 'release'
        THEN le.amount_gross ELSE 0 END), 0) AS spend
    FROM ledger_entry le
    INNER JOIN campaign c ON c.id = le.campaign_id
    WHERE c.brand_user_id = ${userId}::uuid
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 10
  `;
  return rows.map((r) => ({
    period: r.period,
    deposits: dec(r.deposits),
    spend: dec(r.spend),
  }));
}
