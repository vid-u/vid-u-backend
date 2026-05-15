-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "WaitlistRole" AS ENUM ('brand', 'creator');

-- CreateEnum
CREATE TYPE "user_role_enum" AS ENUM ('creator', 'brand');

-- CreateEnum
CREATE TYPE "platform_enum" AS ENUM ('tiktok', 'facebook');

-- CreateEnum
CREATE TYPE "link_status_enum" AS ENUM ('connected', 'reconnect');

-- CreateEnum
CREATE TYPE "payout_purpose_enum" AS ENUM ('creator_payout', 'brand_refund');

-- CreateEnum
CREATE TYPE "payment_method_kind_enum" AS ENUM ('e_wallet', 'bank');

-- CreateEnum
CREATE TYPE "campaign_status_enum" AS ENUM ('draft', 'active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "submission_status_enum" AS ENUM ('pending', 'paying', 'paid', 'payout_failed', 'rejected');

-- CreateEnum
CREATE TYPE "partial_reason_enum" AS ENUM ('pool_exhausted', 'channel_max');

-- CreateEnum
CREATE TYPE "ledger_type_enum" AS ENUM ('deposit', 'release_attempt', 'release', 'release_failed', 'refund_available', 'adjustment');

-- CreateEnum
CREATE TYPE "session_status_enum" AS ENUM ('pending', 'paid', 'expired', 'failed');

-- CreateTable
CREATE TABLE "waitlist" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WaitlistRole" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_profile" (
    "user_id" UUID NOT NULL,
    "role" "user_role_enum" NOT NULL,
    "profile_onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_role_profile_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "brand_profile" (
    "user_id" UUID NOT NULL,
    "brand_name" TEXT NOT NULL,
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "tiktok" TEXT,
    "logo_object_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "creator_platform_account" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "platform_enum" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "last_refreshed_at" TIMESTAMP(3),
    "last_refresh_error" TEXT,
    "link_status" "link_status_enum" NOT NULL DEFAULT 'connected',
    "display_handle" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_platform_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "payout_purpose_enum" NOT NULL,
    "kind" "payment_method_kind_enum" NOT NULL,
    "xendit_channel_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bank_name" TEXT,
    "last_four" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "brand_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rate_per_1k" DECIMAL(14,2) NOT NULL,
    "gross_budget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "spent_budget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "goal_views" BIGINT NOT NULL,
    "platforms" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "status" "campaign_status_enum" NOT NULL DEFAULT 'draft',
    "reference_links" JSONB,
    "asset_urls" JSONB,
    "cover_image_object_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "creator_user_id" UUID NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "platform" "platform_enum" NOT NULL,
    "views_locked" BIGINT NOT NULL,
    "funded_views" BIGINT NOT NULL,
    "likes_locked" BIGINT,
    "comments_locked" BIGINT,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "creator_net" DECIMAL(14,2) NOT NULL,
    "partial_reason" "partial_reason_enum",
    "status" "submission_status_enum" NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "last_payout_attempt_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "ledger_type" "ledger_type_enum" NOT NULL,
    "amount_gross" DECIMAL(14,2) NOT NULL,
    "amount_net" DECIMAL(14,2),
    "xendit_invoice_id" TEXT,
    "xendit_payout_id" TEXT,
    "xendit_fee_amount" DECIMAL(14,2),
    "platform_fee_amount" DECIMAL(14,2),
    "failure_reason" TEXT,
    "idempotency_key" TEXT,
    "related_submission_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_checkout_session" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'xendit',
    "external_id" TEXT NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "status" "session_status_enum" NOT NULL DEFAULT 'pending',
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_checkout_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "creator_platform_account_user_id_platform_key" ON "creator_platform_account"("user_id", "platform");

-- CreateIndex
CREATE INDEX "payment_method_user_id_purpose_idx" ON "payment_method"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "campaign_brand_user_id_status_idx" ON "campaign"("brand_user_id", "status");

-- CreateIndex
CREATE INDEX "submission_campaign_id_status_idx" ON "submission"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "submission_creator_user_id_submitted_at_idx" ON "submission"("creator_user_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "submission_creator_user_id_normalized_url_idx" ON "submission"("creator_user_id", "normalized_url");

-- CreateIndex
CREATE INDEX "ledger_entry_campaign_id_idx" ON "ledger_entry"("campaign_id");

-- CreateIndex
CREATE INDEX "ledger_entry_related_submission_id_created_at_idx" ON "ledger_entry"("related_submission_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ledger_entry_xendit_payout_id_idx" ON "ledger_entry"("xendit_payout_id");

-- CreateIndex
CREATE INDEX "ledger_entry_xendit_invoice_id_idx" ON "ledger_entry"("xendit_invoice_id");

-- CreateIndex
CREATE INDEX "ledger_entry_idempotency_key_idx" ON "ledger_entry"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "funding_checkout_session_external_id_key" ON "funding_checkout_session"("external_id");

-- CreateIndex
CREATE INDEX "funding_checkout_session_campaign_id_idx" ON "funding_checkout_session"("campaign_id");

-- AddForeignKey
ALTER TABLE "user_role_profile" ADD CONSTRAINT "user_role_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_profile" ADD CONSTRAINT "brand_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_platform_account" ADD CONSTRAINT "creator_platform_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_brand_user_id_fkey" FOREIGN KEY ("brand_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_creator_user_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_related_submission_id_fkey" FOREIGN KEY ("related_submission_id") REFERENCES "submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_checkout_session" ADD CONSTRAINT "funding_checkout_session_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes (plan §ERD indexes)
CREATE UNIQUE INDEX "submission_creator_url_active_partial"
ON "submission" ("creator_user_id", "normalized_url")
WHERE "status" <> 'rejected';

CREATE UNIQUE INDEX "payment_method_one_default_per_purpose"
ON "payment_method" ("user_id", "purpose")
WHERE "is_default" = true;

CREATE UNIQUE INDEX "ledger_entry_idempotency_key_unique"
ON "ledger_entry" ("idempotency_key")
WHERE "idempotency_key" IS NOT NULL;
