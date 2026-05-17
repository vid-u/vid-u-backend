-- xenPlatform: one Owned sub-account per brand (for-user-id on money-in/out).
ALTER TABLE "brand_profile"
  ADD COLUMN "xendit_sub_account_id" TEXT;

CREATE UNIQUE INDEX "brand_profile_xendit_sub_account_id_key"
  ON "brand_profile" ("xendit_sub_account_id")
  WHERE "xendit_sub_account_id" IS NOT NULL;

-- Snapshot which sub-account (if any) the checkout invoice was created under.
ALTER TABLE "funding_checkout_session"
  ADD COLUMN "xendit_sub_account_id" TEXT;
