-- Planned gross budget for draft checkout pre-fill; goal_views stay 0 until first deposit.
ALTER TABLE "campaign" ADD COLUMN "planned_gross_budget" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Backfill planned amount from pre-funding goal_views where possible (unfunded drafts).
UPDATE "campaign" c
SET "planned_gross_budget" = GREATEST(
  0,
  ROUND(
    (c."goal_views"::numeric * c."rate_per_1k" / 1000.0) / 0.85,
    2
  )
)
WHERE c."gross_budget" = 0
  AND c."goal_views" > 0
  AND c."rate_per_1k" > 0;

-- Unfunded drafts should not show a reach goal until funded.
UPDATE "campaign"
SET "goal_views" = 0
WHERE "gross_budget" = 0
  AND "status" = 'draft';
