-- Dual Meta app: Page OAuth token (read_insights / pages_*) stored beside Login token.
ALTER TABLE "creator_platform_account"
  ADD COLUMN "page_access_token_encrypted" TEXT,
  ADD COLUMN "page_token_expires_at" TIMESTAMPTZ(3);
