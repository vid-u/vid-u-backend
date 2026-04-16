# Supabase setup

This backend needs Supabase for:

- Postgres (`DATABASE_URL`)
- Auth token verification (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`)

Solana wallet login is handled by **Supabase Auth (Web3)** on the client. This API never sees wallet private keys; it only validates **`Authorization: Bearer <access_token>`** from Supabase.

---

## 1. Create Supabase project

1. Create a project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Save the DB password you choose.

---

## 2. Enable Solana / Web3 authentication (required for wallet login)

Without this, wallet sign-in fails (often **422** — Web3 provider disabled).

1. In the Supabase dashboard: **Authentication** → **Providers**.
2. Find **Web3** (sometimes under “Additional providers”).
3. Turn **Web3** on and **Save**.

Official walkthrough (Next.js template; dashboard steps are the same for any app):

- [How to Authenticate Users with Solana Wallets Using Supabase](https://solana.com/developers/guides/getstarted/supabase-auth-guide.md)

After Web3 is enabled, the client can use **`supabase.auth.signInWithWeb3()`** with a connected Solana wallet so Supabase issues a normal **session** (`access_token` / `refresh_token`).

---

## 3. Environment variables (this API)

Copy from [`.env.example`](../.env.example) and set:

| Variable                    | Required | Where to get it                          |
| --------------------------- | -------- | ---------------------------------------- |
| `DATABASE_URL`              | Yes      | Supabase **Project Settings → Database** |
| `SUPABASE_URL`              | Yes      | Supabase **Project Settings → API**      |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Supabase **Project Settings → API**      |

Notes:

- If DB password has special chars (`@`, `#`, `/`), URL-encode it in `DATABASE_URL`.
- **`SUPABASE_SERVICE_ROLE_KEY`** is **server-only**. It is used to call `auth.getUser(jwt)` for Bearer tokens. Never expose it in a browser or frontend bundle.

The **anon (public) key** is for the **web app only**, not for this Node server.

---

## 4. Apply database schema

From `bughyve-backend-solana`:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
```

For local-only development DBs, you can use `npx prisma migrate dev`.

---

## 5. Verify backend startup

With env vars set, run the backend and confirm:

- `GET /health` returns OK
- `GET /health/ready` returns OK when DB is reachable

---

## 6. Link `public.users` after wallet sign-in

Yes — this step is required for app data: Supabase Auth only creates **`auth.users`**. This API upserts **`public.users`** (Prisma `User`) with **`id` = Supabase Auth user id** so `loadDbUser` can resolve the DB row.

After **`signInWithWeb3`** (or any session), call once per session as needed:

- **`POST /auth/sync`** (relative to your API origin, e.g. `https://api.example.com/auth/sync`)
  - Header: `Authorization: Bearer <access_token>`
  - Body: `{ "walletAddress": "<Solana base58 pubkey>", "role": "client" | "tester" }` — `role` optional (defaults to `tester`)

Use the **same** pubkey as the wallet used for Web3 sign-in.

Frontend walkthrough: **[Supabase Solana auth (web UI)](../../bughyve-web-solana/docs/supabase-solana-auth.md)** in `bughyve-web-solana`.

---

## 7. Optional (production hardening)

- Set `NODE_ENV=production`
- Set `FRONTEND_URL` for CORS (your frontend origin(s), e.g. `http://localhost:5173` in dev)
- Set `CRON_SECRET` if calling `POST /jobs/check-expired` from a scheduler
