-- Store Facebook Page id/name list for account UI tooltips.
ALTER TABLE "creator_platform_account" ADD COLUMN IF NOT EXISTS "linked_pages_json" JSONB;
