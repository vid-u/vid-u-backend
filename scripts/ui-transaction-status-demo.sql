-- =============================================================================
-- VidU — Transaction history UI demo data
-- =============================================================================
-- 1. Edit the campaign UUID in set_config() below (one line).
-- 2. Run the ENTIRE script in one go (Supabase: select all → Run).
--
-- If you see "current transaction is aborted":
--   Run:  ROLLBACK;
--   Fix the campaign UUID, then run this script again.
--
-- =============================================================================

-- Clears a leftover aborted transaction from a previous failed run (safe if none).
ROLLBACK;

-- >>> EDIT ONLY THIS UUID (must exist in campaign table) <<<
SELECT set_config('app.ui_demo_campaign_id', 'cedb0f7e-774f-46e2-9a1c-1bd4b08b9e17', false);

DO $$
BEGIN
  IF current_setting('app.ui_demo_campaign_id', true) IS NULL
     OR current_setting('app.ui_demo_campaign_id', true) = '00000000-0000-0000-0000-000000000000'
  THEN
    RAISE EXCEPTION 'Replace the placeholder UUID in set_config() with your real campaign id.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM campaign
    WHERE id = current_setting('app.ui_demo_campaign_id', true)::uuid
  ) THEN
    RAISE EXCEPTION 'Campaign not found: %. Check the id from: SELECT id, title FROM campaign LIMIT 20;',
      current_setting('app.ui_demo_campaign_id', true);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Remove previous demo rows
-- -----------------------------------------------------------------------------
DELETE FROM funding_checkout_session
WHERE campaign_id = current_setting('app.ui_demo_campaign_id', true)::uuid
  AND external_id LIKE 'fund_ui_demo_%';

DELETE FROM ledger_entry
WHERE campaign_id = current_setting('app.ui_demo_campaign_id', true)::uuid
  AND idempotency_key LIKE 'ui_demo_%';

-- -----------------------------------------------------------------------------
-- Ledger rows (stable in UI)
-- -----------------------------------------------------------------------------

INSERT INTO ledger_entry (
  id, campaign_id, ledger_type, amount_gross, amount_net,
  note, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'deposit',
  10000.00,
  NULL,
  'initial_fund',
  'ui_demo_deposit_initial_fund',
  NOW() - INTERVAL '7 days';

INSERT INTO ledger_entry (
  id, campaign_id, ledger_type, amount_gross, amount_net,
  note, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'deposit',
  2500.00,
  NULL,
  'top_up',
  'ui_demo_deposit_top_up',
  NOW() - INTERVAL '6 days';

INSERT INTO ledger_entry (
  id, campaign_id, ledger_type, amount_gross, amount_net,
  note, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'refund_available',
  500.00,
  NULL,
  'brand_refund',
  'ui_demo_refund_completed',
  NOW() - INTERVAL '5 days';

INSERT INTO ledger_entry (
  id, campaign_id, ledger_type, amount_gross, amount_net,
  note, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'release_attempt',
  300.00,
  NULL,
  'brand_refund_pending',
  'ui_demo_refund_processing',
  NOW() - INTERVAL '4 days';

INSERT INTO ledger_entry (
  id, campaign_id, ledger_type, amount_gross, amount_net,
  note, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'release',
  150.00,
  127.50,
  'creator_payout',
  'ui_demo_creator_payout',
  NOW() - INTERVAL '3 days';

INSERT INTO ledger_entry (
  id, campaign_id, ledger_type, amount_gross, amount_net,
  failure_reason, note, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'release_failed',
  200.00,
  NULL,
  'Demo: insufficient balance in channel (UI preview)',
  'creator_payout_failed',
  'ui_demo_creator_payout_failed',
  NOW() - INTERVAL '2 days';

INSERT INTO ledger_entry (
  id, campaign_id, ledger_type, amount_gross, amount_net,
  failure_reason, note, idempotency_key, created_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'release_failed',
  400.00,
  NULL,
  'Demo: bank account rejected (UI preview)',
  'brand_refund_failed',
  'ui_demo_refund_failed',
  NOW() - INTERVAL '1 day';

-- -----------------------------------------------------------------------------
-- Funding checkout sessions
-- -----------------------------------------------------------------------------

INSERT INTO funding_checkout_session (
  id, campaign_id, provider, external_id, xendit_invoice_id, intent,
  checkout_url, status, gross_amount, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'xendit',
  'fund_ui_demo_expired',
  'ui_demo_invoice_expired',
  'add_funds',
  'https://example.com/checkout/ui-demo-expired',
  'expired',
  750.00,
  NOW() - INTERVAL '12 hours',
  NOW() - INTERVAL '12 hours';

INSERT INTO funding_checkout_session (
  id, campaign_id, provider, external_id, xendit_invoice_id, intent,
  checkout_url, status, gross_amount, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'xendit',
  'fund_ui_demo_failed',
  'ui_demo_invoice_failed',
  'add_funds',
  'https://example.com/checkout/ui-demo-failed',
  'failed',
  900.00,
  NOW() - INTERVAL '10 hours',
  NOW() - INTERVAL '10 hours';

INSERT INTO funding_checkout_session (
  id, campaign_id, provider, external_id, xendit_invoice_id, intent,
  checkout_url, status, gross_amount, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'xendit',
  'fund_ui_demo_awaiting_credit',
  'ui_demo_invoice_paid_not_credited',
  'add_funds',
  'https://example.com/checkout/ui-demo-awaiting-credit',
  'pending',
  10000.00,
  NOW() - INTERVAL '8 hours',
  NOW() - INTERVAL '8 hours';

INSERT INTO funding_checkout_session (
  id, campaign_id, provider, external_id, xendit_invoice_id, intent,
  checkout_url, status, gross_amount, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  current_setting('app.ui_demo_campaign_id', true)::uuid,
  'xendit',
  'fund_ui_demo_awaiting_payment',
  'ui_demo_invoice_open',
  'add_funds',
  'https://checkout-staging.xendit.co/web/ui-demo-open',
  'pending',
  1000.00,
  NOW() - INTERVAL '6 hours',
  NOW() - INTERVAL '6 hours';

-- -----------------------------------------------------------------------------
-- Verify
-- -----------------------------------------------------------------------------
SELECT 'ledger' AS source, ledger_type::text, note, amount_gross, created_at
FROM ledger_entry
WHERE idempotency_key LIKE 'ui_demo_%'
ORDER BY created_at DESC;

SELECT 'checkout' AS source, external_id, status::text, gross_amount, created_at
FROM funding_checkout_session
WHERE external_id LIKE 'fund_ui_demo_%'
ORDER BY created_at DESC;

-- =============================================================================
-- CLEANUP ONLY
-- =============================================================================
/*
SELECT set_config('app.ui_demo_campaign_id', 'YOUR-CAMPAIGN-UUID', false);

DELETE FROM funding_checkout_session
WHERE campaign_id = current_setting('app.ui_demo_campaign_id', true)::uuid
  AND external_id LIKE 'fund_ui_demo_%';

DELETE FROM ledger_entry
WHERE campaign_id = current_setting('app.ui_demo_campaign_id', true)::uuid
  AND idempotency_key LIKE 'ui_demo_%';
*/
