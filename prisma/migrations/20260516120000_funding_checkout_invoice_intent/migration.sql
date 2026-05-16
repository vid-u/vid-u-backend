-- Store Xendit invoice id + checkout intent for funding history and sync.
ALTER TABLE "funding_checkout_session"
  ADD COLUMN "xendit_invoice_id" TEXT,
  ADD COLUMN "intent" TEXT;
