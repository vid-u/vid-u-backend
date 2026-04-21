# BugHyve API (Solana MVP)

Backend service for **BugHyve** — a human QA marketplace where clients fund bug-bounty-style campaigns on Solana and testers submit findings for review and payout.

This repo is the **Node.js / Express** layer: it owns **business rules**, talks to **Supabase Postgres** (via Prisma), verifies **Supabase Auth** JWTs, can issue **presigned URLs** for **Cloudflare R2** uploads, and coordinates **Solana** work: verifying client-signed transactions (fund, approve, …), signing **backend authority** instructions (`allocate_submission`, `pause_campaign` / `resume_campaign`, optional `reject_submission`), and keeping **Postgres** aligned with on-chain escrow after RPC confirmation.

## How this fits the monorepo

| Piece                                                    | Role                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`bughyve-web-solana`](../bughyve-web-solana/)**       | React (Vite) app. Point its API base URL at this server (e.g. `http://localhost:3001` in dev). Users sign in with a wallet + Supabase session, then call protected routes with `Authorization: Bearer …`. |
| **This API**                                             | Source of truth for app data in Postgres; campaign lifecycle, submissions, escrow-backed balances, and payout rows aligned with the Anchor program.                                                      |
| **[`bughyve-escrow-solana`](../bughyve-escrow-solana/)** | Anchor program — campaign PDAs, USDC escrow, payouts. The app and API align with program accounts and instructions described in the architecture doc.                                                     |

Design details, schema, and flows: **[MVP architecture & spec](../bughyve-mvp-architecture-solana/bughyve-mvp-architecture.md)**.

## Prerequisites

- **Node.js 20.19+**
- A **[Supabase](https://supabase.com)** project (Postgres + Auth) — or use Docker Compose below for Postgres only while still using Supabase for Auth.

## Documentation

- **[Supabase setup](./docs/supabase-setup.md)** — database URL, keys, auth sync
- **[Cloudflare R2](./docs/cloudflare-r2.md)** — optional file uploads
- **[Deployment](./docs/deployment.md)** — production build, env, Railway notes
- **[Campaign funding sync](./docs/campaign-funding-sync.md)** — `GET`/`POST` `/client/campaigns/:id/sync-fund` when Solana funded but `/fund` API failed

See **[`docs/README.md`](./docs/README.md)** for the full index.

## Run locally (Supabase Postgres)

1. **Environment**

   ```bash
   cp .env.example .env
   ```

   Fill **`DATABASE_URL`**, **`SUPABASE_URL`**, and **`SUPABASE_SERVICE_ROLE_KEY`** from your Supabase project. URL-encode special characters in the DB password.

2. **Install & Prisma**

   ```bash
   npm install
   npx prisma generate
   ```

3. **Migrations**

   ```bash
   npx prisma migrate dev
   ```

   (Use `npx prisma migrate deploy` if you already have an up-to-date schema and only need to apply pending migrations.)

4. **Start**

   ```bash
   npm run dev
   ```

   Default: **http://localhost:3001** — try `GET /health` and `GET /` for a quick route list.

## Run locally (Docker Compose)

Optional: **Postgres in Docker** plus the API in a container (see [`docker-compose.yml`](./docker-compose.yml)). Copy `.env.example` → `.env` with Supabase keys; Compose overrides `DATABASE_URL` to use the bundled Postgres. Run:

```bash
docker compose up -d
```

## Scripts

| Command                   | Purpose                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `npm run dev`             | Dev server with reload (`tsx watch`)                                       |
| `npm run build`           | Compile to `dist/`                                                         |
| `npm start`               | `prisma migrate deploy` then run compiled app (production / Railway default) |
| `npm run prisma:migrate`  | `prisma migrate dev`                                                       |
| `npm run prisma:generate` | Regenerate Prisma Client after schema changes                              |
