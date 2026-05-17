# Prisma migrations

## Order (do not rename or reorder)

| Migration | Purpose |
|-----------|---------|
| `20260211100000_vid_u_waitlist_only` | Marketing / production waitlist (`waitlist`, `WaitlistRole`) |
| `20260214120000_mvp_init` | MVP app tables (users, campaigns, submissions, ledger, …) — **must not** recreate waitlist |
| `20260515120000_campaign_planned_gross_budget` | `campaign.planned_gross_budget` |
| `20260516120000_funding_checkout_invoice_intent` | Checkout invoice id + intent |
| `20260517120000_brand_xendit_sub_account` | Brand xenPlatform sub-account columns |
| `20260517140000_brand_xendit_transfer_state` | Transfer state on funding sessions |
| `20260518120000_xendit_split_funding_pending` | `funding_pending` status + split columns |

## Production already on waitlist-only

Deployed DBs that only have `20260211100000_vid_u_waitlist_only` applied:

1. Deploy code that includes the **fixed** `mvp_init` (no `CREATE TYPE "WaitlistRole"` / `CREATE TABLE "waitlist"`).
2. Run:

   ```bash
   npm run prisma:migrate:deploy
   ```

   Prisma applies `mvp_init` and all later migrations in order.

3. Validate locally before deploy:

   ```bash
   npm run prisma:migrate:validate
   ```

### If `mvp_init` fails with “WaitlistRole already exists”

The migration file still duplicates the waitlist migration (pre–`442b78e` content). **Do not** merge that version. `mvp_init` must only contain a comment pointing at `20260211100000_vid_u_waitlist_only`, not `CREATE` for waitlist objects.

### If a previous deploy left `mvp_init` in a failed state

```bash
npx prisma migrate resolve --rolled-back 20260214120000_mvp_init
npm run prisma:migrate:deploy
```

Only use `--rolled-back` if the migration did not fully apply (check `_prisma_migrations` and that MVP tables are missing).

### If the DB has waitlist data but no `_prisma_migrations` row

Baseline the first migration, then deploy:

```bash
npx prisma migrate resolve --applied 20260211100000_vid_u_waitlist_only
npm run prisma:migrate:deploy
```

## Rules for merges

- **Never edit** SQL for a migration that has already been applied in production (changes checksum → P3018).
- **Never add** a second migration that recreates `waitlist` or `WaitlistRole`.
- New schema changes: add a **new** timestamped folder under `prisma/migrations/`, then `prisma migrate dev`.
- Run `npm run prisma:migrate:validate` in CI or before opening a PR that touches `prisma/migrations/`.

## Fresh database

`npm run prisma:migrate:deploy` applies all seven migrations from empty Postgres (waitlist first, then MVP).
