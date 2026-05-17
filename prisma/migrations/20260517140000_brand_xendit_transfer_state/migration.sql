ALTER TABLE "brand_profile"
  ADD COLUMN "xendit_sub_account_status" TEXT,
  ADD COLUMN "xendit_pending_initial_transfer_amount" DECIMAL(14, 2),
  ADD COLUMN "xendit_pending_initial_transfer_ref" TEXT,
  ADD COLUMN "xendit_initial_transfer_completed_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "brand_profile_xendit_pending_initial_transfer_ref_key"
  ON "brand_profile" ("xendit_pending_initial_transfer_ref")
  WHERE "xendit_pending_initial_transfer_ref" IS NOT NULL;
