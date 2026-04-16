-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('client', 'tester');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "CampaignVisibility" AS ENUM ('private', 'public', 'restricted');

-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('bug', 'feedback');

-- CreateEnum
CREATE TYPE "SubmissionSeverity" AS ENUM ('critical', 'high', 'medium', 'mild');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('submitted', 'in-review', 'approved', 'rejected', 'disputed');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "WaitlistRole" AS ENUM ('client', 'tester');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "display_name" TEXT,
    "bio" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "user_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_person" TEXT,
    "description" TEXT,
    "logo_url" TEXT,
    "contact_email" TEXT,
    "website_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "tester_work_preferences" (
    "user_id" UUID NOT NULL,
    "specializations" TEXT[],
    "primary_devices" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tester_work_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "tester_availability" (
    "user_id" UUID NOT NULL,
    "availability_to_start" TEXT,
    "preferred_time_commitment" TEXT,
    "custom_days" TEXT,
    "working_hours" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tester_availability_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "client_payment_methods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "label" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT,
    "out_of_scope" TEXT,
    "in_scope_test_case_url" TEXT,
    "disclosure_guidelines" TEXT,
    "reward_eligibility" TEXT,
    "download_links" JSONB,
    "start_date" DATE,
    "end_date" DATE,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "budget" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "budget_remaining" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "available_balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "allocated_balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "device_requirements" TEXT[],
    "visibility" "CampaignVisibility" NOT NULL DEFAULT 'private',
    "listed" BOOLEAN NOT NULL DEFAULT false,
    "escrow_pda" TEXT,
    "review_window_days" INTEGER,
    "severity_rewards" JSONB,
    "creation_fee_paid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "tester_id" UUID NOT NULL,
    "kind" "SubmissionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "steps_to_reproduce" TEXT NOT NULL,
    "expected_behavior" TEXT,
    "actual_behavior" TEXT,
    "device_info" TEXT,
    "devices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "browser" TEXT,
    "additional_notes" TEXT,
    "video_url" TEXT,
    "severity" "SubmissionSeverity" NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'submitted',
    "rejection_text" TEXT,
    "allocated_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "payout_amount" DECIMAL(20,8),
    "evidence_urls" TEXT[],
    "resource_links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_comments" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "parent_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_logs" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "actor_id" UUID,
    "event_type" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "tester_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "gross_amount" DECIMAL(20,8) NOT NULL,
    "tester_amount" DECIMAL(20,8) NOT NULL,
    "platform_fee" DECIMAL(20,8) NOT NULL,
    "tx_signature" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_fees" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "tx_signature" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WaitlistRole" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE INDEX "client_payment_methods_user_id_idx" ON "client_payment_methods"("user_id");

-- CreateIndex
CREATE INDEX "campaigns_client_id_idx" ON "campaigns"("client_id");

-- CreateIndex
CREATE INDEX "campaigns_listed_status_escrow_pda_idx" ON "campaigns"("listed", "status", "escrow_pda");

-- CreateIndex
CREATE INDEX "submissions_campaign_id_idx" ON "submissions"("campaign_id");

-- CreateIndex
CREATE INDEX "submissions_tester_id_idx" ON "submissions"("tester_id");

-- CreateIndex
CREATE INDEX "submissions_status_idx" ON "submissions"("status");

-- CreateIndex
CREATE INDEX "submission_comments_submission_id_idx" ON "submission_comments"("submission_id");

-- CreateIndex
CREATE INDEX "submission_logs_submission_id_idx" ON "submission_logs"("submission_id");

-- CreateIndex
CREATE INDEX "payouts_submission_id_idx" ON "payouts"("submission_id");

-- CreateIndex
CREATE INDEX "payouts_tester_id_idx" ON "payouts"("tester_id");

-- CreateIndex
CREATE INDEX "payouts_campaign_id_idx" ON "payouts"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_fees_campaign_id_idx" ON "campaign_fees"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tester_work_preferences" ADD CONSTRAINT "tester_work_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tester_availability" ADD CONSTRAINT "tester_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_payment_methods" ADD CONSTRAINT "client_payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tester_id_fkey" FOREIGN KEY ("tester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_comments" ADD CONSTRAINT "submission_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "submission_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_logs" ADD CONSTRAINT "submission_logs_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_logs" ADD CONSTRAINT "submission_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tester_id_fkey" FOREIGN KEY ("tester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_fees" ADD CONSTRAINT "campaign_fees_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_fees" ADD CONSTRAINT "campaign_fees_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
