-- AlterEnum
ALTER TYPE "campaign_status_enum" ADD VALUE IF NOT EXISTS 'funding_pending';

-- AlterTable
ALTER TABLE "brand_profile"
ADD COLUMN IF NOT EXISTS "xendit_deposit_split_rule_id" TEXT;

-- AlterTable
ALTER TABLE "funding_checkout_session"
ADD COLUMN IF NOT EXISTS "xendit_split_rule_id" TEXT,
ADD COLUMN IF NOT EXISTS "xendit_split_settled_at" TIMESTAMP(3);
