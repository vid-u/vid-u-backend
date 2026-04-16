# Deployment guide — BugHyve backend (Railway)

This guide is Railway-specific and covers both:

- `bughyve-api` (the Express backend service)
- `bughyve-cron` (a scheduled worker that calls the jobs endpoint)

**Environment variables:** Supabase + Postgres + Auth keys are documented in **[Supabase setup](./supabase-setup.md)**. Optional R2 upload keys are in **[Cloudflare R2](./cloudflare-r2.md)**. Copy from [`.env.example`](../.env.example) and set values in Railway (or your host).

## 1. Requirements

- Railway account + project
- GitHub repo connected to Railway
- **Node.js 20.19+** (see `package.json` `engines`)
- Supabase project (Postgres + Auth)
- Optional Cloudflare R2 bucket (uploads) — see [Cloudflare R2](./cloudflare-r2.md)

## 2. Railway project layout

Create two services in one Railway project:

1. **`bughyve-api`** — public web service running this backend
2. **`bughyve-cron`** — scheduled worker/cron service (no public traffic needed)

Use the same source folder for both: `bughyve-solana-hackathon/bughyve-backend-solana`.

## 3. Configure `bughyve-api` (backend)

### Build and start commands

- Build:

```bash
npm ci && npm run build
```

- Start (default **`npm start`** — applies pending migrations, then boots the server):

```bash
npm start
```

To boot **without** migrating (advanced), set the start command to **`node dist/index.js`** and run **`npx prisma migrate deploy`** from a shell or CI when you ship schema changes.

### Environment variables

Copy from [`.env.example`](../.env.example), then set these in Railway Variables:

| Variable                    | Required          | Notes                                   |
| --------------------------- | ----------------- | --------------------------------------- |
| `NODE_ENV`                  | Yes               | `production`                            |
| `PORT`                      | Usually auto      | Railway injects `PORT` for web services |
| `DATABASE_URL`              | Yes               | Supabase Postgres URI                   |
| `SUPABASE_URL`              | Yes               | Supabase project URL                    |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes               | Server-only secret                      |
| `FRONTEND_URL`              | Recommended       | Comma-separated allowed CORS origins    |
| `CRON_SECRET`               | Yes in production | Shared secret for jobs endpoint         |
| `R2_ACCOUNT_ID`             | Optional          | Needed for R2 uploads                   |
| `R2_ACCESS_KEY_ID`          | Optional          | Needed for R2 uploads                   |
| `R2_SECRET_ACCESS_KEY`      | Optional          | Needed for R2 uploads                   |
| `R2_BUCKET`                 | Optional          | Needed for R2 uploads                   |
| `R2_PUBLIC_BASE_URL`        | Optional          | Public avatar/logo URL base             |

Never commit secrets to git.

## 4. Production migrations

**Automated (on each deploy):** Use the default **Start Command** **`npm start`**. Each boot runs **`prisma migrate deploy`** (applies any pending migrations) and then **`node dist/index.js`**. Pushing a commit that includes new migration files will migrate the prod DB when the new container starts.

**Caveats:**

- If a migration fails, the process exits and the previous deployment typically keeps running — fix the migration or DB state, then redeploy.
- Multiple instances starting at once are safe: Prisma uses database-level locking during migrate.
- The **`prisma`** CLI is a **runtime** dependency so `migrate deploy` works even when the host omits devDependencies.

**Manual fallback** (shell, CI, or local) if you prefer not to migrate at boot:

```bash
npm ci
npx prisma migrate deploy
```

## 5. Health checks

Validate the API after deploy:

- `GET /health` (liveness)
- `GET /health/ready` (readiness + DB check)

## 6. Configure `bughyve-cron` (scheduler worker)

The cron worker triggers:

- `POST /jobs/check-expired` (on the same host as `API_BASE_URL`, no extra path prefix)

with:

- `x-cron-secret: <CRON_SECRET>`

### Variables for cron service

Set in `bughyve-cron`:

- `API_BASE_URL` (for example `https://bughyve-api.up.railway.app`)
- `CRON_SECRET` (must match `bughyve-api` exactly)

### Cron command example

```bash
curl -sS -X POST "$API_BASE_URL/jobs/check-expired" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json"
```

Set Railway schedule (for example every 5-10 minutes or hourly based on need).

## 7. CORS

The app reads `FRONTEND_URL` (comma-separated). Add every production and preview frontend origin that should call this API.

## 8. Rollback

- **App:** redeploy previous successful Railway deployment.
- **Database:** avoid destructive manual SQL; fix forward with a new migration, or restore backup if required.

## 9. Production checklist

- [ ] `bughyve-api` deployed and healthy
- [ ] `NODE_ENV=production`
- [ ] Migrations apply on deploy (`npm start`) or you ran `prisma migrate deploy` manually
- [ ] `CRON_SECRET` set on both API and cron services
- [ ] Railway cron schedule active
- [ ] CORS origins correct for frontend domain(s)
- [ ] Optional R2 variables set and tested

See also [Supabase setup](./supabase-setup.md) and [Cloudflare R2](./cloudflare-r2.md) for full env var details.
