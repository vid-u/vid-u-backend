# Environment setup (VidU backend)

Copy `vidu-backend/.env.example` to `vidu-backend/.env` and fill values locally. Never commit real secrets.

## Database

- `DATABASE_URL`: Postgres connection string used by Prisma. Run migrations from `vidu-backend` with `npm run prisma:migrate:deploy` (or `prisma:migrate` in development).

## CORS (`FRONTEND_URL`)

- **Comma-separated** list of origins the browser may use when calling `api.vid-u.com` (waitlist, public campaigns, authenticated SPA routes).
- Each entry automatically gains the matching **apex / `www.`** variant (except `localhost`).
- **First origin must be your primary SPA** (e.g. `https://www.app.vid-u.com`): TikTok/Meta OAuth callbacks redirect users there (`oauth.controller` reads only the first entry).
- If the marketing site (`https://www.vid-u.com`) POSTs to `/waitlist` but **that origin is not allowlisted**, the browser shows a CORS error and **no `Access-Control-Allow-Origin`** on the preflight response — fix by including both app + marketing in `FRONTEND_URL`.

Example production:

`FRONTEND_URL=https://www.app.vid-u.com,https://www.vid-u.com`

## Supabase Auth

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`: from the Supabase project **Settings → API**. Used for email OTP, Google OAuth token exchange, and (with anon key) public auth endpoints.
- `SUPABASE_SERVICE_ROLE_KEY`: **server only**. Required to set `app_metadata.vidu_role` after `PUT /me/role` so JWTs carry the selected role. Do not expose to the browser.
- **`SUPABASE_JWT_SECRET` (optional):** set **only** when your tokens are **HS256** signed with this secret (some local/emulator setups). When unset, the API uses **RS256** and fetches JWKS from `SUPABASE_JWKS_URL` if set, otherwise **`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`**.
- **`SUPABASE_JWKS_URL` (optional):** override the JWKS URL. Typical hosted Supabase projects need **neither** `SUPABASE_JWT_SECRET` nor `SUPABASE_JWKS_URL`.
- Configure **redirect URLs** in Supabase for Google OAuth: allow `PUBLIC_API_URL` + `/auth/google/callback` (or your deployed API host).

## Xendit

- `XENDIT_SECRET_KEY`: **secret API key** for `api.xendit.co` (Basic auth) for invoices and payouts.
- `XENDIT_WEBHOOK_TOKEN`: callback verification token; the API checks the `x-callback-token` header on `POST /webhooks/xendit`. Expose that route via **ngrok** or **cloudflared** when testing webhooks locally.

## OAuth (TikTok / Meta)

- **TikTok:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and `TIKTOK_REDIRECT_URI` (must match the Login Kit redirect you register; production TikTok requires **https** callbacks). Creators hit `GET /oauth/tiktok/start` (Bearer) → TikTok → `GET /oauth/tiktok/callback` → redirect to `FRONTEND_URL` with `oauth=success|error`.
- **Meta (Facebook Login + Instagram):** `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` (must be `.../oauth/facebook/callback`). Scopes include Instagram insights; the creator needs a **professional Instagram** linked to a **Facebook Page** they manage for best results.
- **`OAUTH_STATE_SECRET`:** at least 32 characters used to sign short-lived `state` JWTs (CSRF). If omitted in development, the API falls back to `TOKEN_ENCRYPTION_KEY` hex; set explicitly in production.

## Ledger reconciliation

- There is **no in-process daily cron** in this API. Recompute campaign budget caches from the ledger with **`POST /admin/reconcile-campaign/:campaignId`** (HTTP **Basic** auth; see Admin below).

## Creator campaign discovery (`GET /campaigns`)

- **Auth:** creator JWT.
- **Query (optional):** `status` = `all` | `active` | `paused` | `ended` (default `all` — excludes `draft`); `platform` = `tiktok` | `facebook`; `sort` = `newest` | `highest_rate` (default `newest`).
- **Response:** `data.items` (max 50), `data.limit` (50), `data.filters` (echo of resolved query). Cards include `brandName`, `status`, `grossBudget`, `spentBudget`, `availableBudget`, optional `coverImageUrl` / `brandLogoUrl` when `PUBLIC_OBJECT_BASE_URL` is set.

## Payment methods

- **`GET|POST|PATCH|DELETE /me/payment-methods`** (authenticated; user must have selected a role). **`purpose`** is set from the resolved role: **creator** → `creator_payout`, **brand** → `brand_refund` (not sent by the client).
- **`POST`** body: `xenditChannelCode`, `label`, `accountNumber`, `accountName`, optional `bankName` (required for `PH_BDO` / `PH_BPI`), optional `isDefault`. Channel codes must match the server allowlist (see `src/config/xendit_channel_limits.ts`). Account numbers are stored encrypted; API responses only expose **`lastFour`**.

## Uploads (R2 presigned `PUT`)

- **`POST /uploads/presign`** (brand JWT): body `purpose` (`brand_logo` | `campaign_cover`), `contentType` (`image/jpeg` | `image/png` | `image/webp`), and **`campaignId`** when `purpose` is `campaign_cover` (must be a campaign owned by the caller). Returns `uploadUrl`, `objectKey`, optional `publicUrl` (when `PUBLIC_OBJECT_BASE_URL` is set), `method`, `expiresIn`, `maxBytes`, and `headers` the browser must send on `PUT` (at least **`Content-Type`**).
- **R2 (all required for presign to work):** `R2_S3_ENDPOINT` (e.g. `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` from an R2 **S3 API** token in the Cloudflare dashboard. If any are missing, presign returns **503**.
- **`PUBLIC_OBJECT_BASE_URL`:** public origin (no trailing slash) used to build **`publicUrl`** and campaign card URLs; configure your R2 bucket or CDN so objects at `objectKey` are readable at that origin.
- **Tuning (optional env, defaults in `src/config/uploads-r2.ts`):** `UPLOAD_PRESIGN_EXPIRES_SEC`, `UPLOAD_MAX_BYTES` (client-side expectation; enforce size in bucket policy / WAF as well).

## Webapp

- In `vidu-webapp`, set `VITE_API_URL` to the backend base (e.g. `http://localhost:3001`) so the SPA uses real auth endpoints when configured.

## Admin

- **`ADMIN_BASIC_PASSWORD`:** required to enable `/admin/*`. The API expects **`Authorization: Basic`** (username + password, Base64). Use HTTPS in production.
- **`ADMIN_BASIC_USER`:** optional; defaults to **`admin`** if unset.
- **`ADMIN_PRINCIPALS`**, **`ADMIN_JWT_CLAIM`:** defined in env schema for future use; **not read by the server** in the current build.

## Brand campaign limits (optional)

- Defaults are in **`src/config/campaign-limits.ts`** (via `src/config/read-env.ts`). Override with **`MIN_BRAND_RATE_PER_1K`** and **`MIN_GROSS_PUBLISH_PHP`** only when you need non-default thresholds.

## Fees / publish floor (optional)

- Defaults in **`src/config/fees.ts`**. Override with **`PLATFORM_DEPOSIT_FEE_PERCENT`**, **`CREATOR_PAYOUT_FEE_PERCENT`**, **`MIN_PUBLISH_FLOOR_PHP`** when needed.
