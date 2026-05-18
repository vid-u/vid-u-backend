import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export type CreatorPeriodRow = { period: string; earnings: string };

export type BrandPeriodRow = {
  period: string;
  deposits: string;
  spend: string;
};

export type BrandAnalyticsPeriodRow = BrandPeriodRow & {
  views: string;
  payout: string;
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

type BrandPerformanceSlice = { period: string; views: string; payout: string };

function mergeBrandAnalyticsPeriods(
  ledger: BrandPeriodRow[],
  performance: BrandPerformanceSlice[],
): BrandAnalyticsPeriodRow[] {
  const byPeriod = new Map<string, BrandAnalyticsPeriodRow>();
  for (const row of ledger) {
    byPeriod.set(row.period, {
      period: row.period,
      deposits: row.deposits,
      spend: row.spend,
      views: "0",
      payout: "0.00",
    });
  }
  for (const row of performance) {
    const existing = byPeriod.get(row.period) ?? {
      period: row.period,
      deposits: "0.00",
      spend: "0.00",
      views: "0",
      payout: "0.00",
    };
    byPeriod.set(row.period, { ...existing, views: row.views, payout: row.payout });
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
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

/** Funded views and brand gross (`gross_amount`) by submission month (UTC). */
async function getBrandPerformanceByMonth(userId: string): Promise<BrandPerformanceSlice[]> {
  const rows = await prisma.$queryRaw<
    Array<{ period: string; views: unknown; payout: unknown }>
  >`
    SELECT to_char(date_trunc('month', s.submitted_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS period,
      COALESCE(SUM(s.funded_views), 0) AS views,
      COALESCE(SUM(s.gross_amount), 0) AS payout
    FROM submission s
    INNER JOIN campaign c ON c.id = s.campaign_id
    WHERE c.brand_user_id = ${userId}::uuid
      AND s.status::text = 'paid'
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 24
  `;
  return rows.map((r) => ({
    period: r.period,
    views: bigintStr(r.views),
    payout: dec(r.payout),
  }));
}

async function getBrandPerformanceByYear(userId: string): Promise<BrandPerformanceSlice[]> {
  const rows = await prisma.$queryRaw<
    Array<{ period: string; views: unknown; payout: unknown }>
  >`
    SELECT to_char(date_trunc('year', s.submitted_at AT TIME ZONE 'UTC'), 'YYYY') AS period,
      COALESCE(SUM(s.funded_views), 0) AS views,
      COALESCE(SUM(s.gross_amount), 0) AS payout
    FROM submission s
    INNER JOIN campaign c ON c.id = s.campaign_id
    WHERE c.brand_user_id = ${userId}::uuid
      AND s.status::text = 'paid'
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 10
  `;
  return rows.map((r) => ({
    period: r.period,
    views: bigintStr(r.views),
    payout: dec(r.payout),
  }));
}

export async function getBrandAnalyticsByMonth(userId: string): Promise<BrandAnalyticsPeriodRow[]> {
  const [ledger, performance] = await Promise.all([
    getBrandLedgerByMonth(userId),
    getBrandPerformanceByMonth(userId),
  ]);
  return mergeBrandAnalyticsPeriods(ledger, performance);
}

export async function getBrandAnalyticsByYear(userId: string): Promise<BrandAnalyticsPeriodRow[]> {
  const [ledger, performance] = await Promise.all([
    getBrandLedgerByYear(userId),
    getBrandPerformanceByYear(userId),
  ]);
  return mergeBrandAnalyticsPeriods(ledger, performance);
}

export type AnalyticsGranularity = "monthly" | "yearly";

export async function getBrandAnalyticsForGranularity(
  userId: string,
  granularity: AnalyticsGranularity,
): Promise<BrandAnalyticsPeriodRow[]> {
  return granularity === "monthly"
    ? getBrandAnalyticsByMonth(userId)
    : getBrandAnalyticsByYear(userId);
}

export async function getCreatorEarningsForGranularity(
  userId: string,
  granularity: AnalyticsGranularity,
): Promise<CreatorPeriodRow[]> {
  return granularity === "monthly"
    ? getCreatorEarningsByMonth(userId)
    : getCreatorEarningsByYear(userId);
}
