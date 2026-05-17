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

## Session cookie (SPA auth)

- After email verify or Google OAuth, the API sets an **httpOnly** cookie `vidu_session` (Supabase JWT access token). The SPA must call the API with **`credentials: include`** (Axios `withCredentials: true`). CORS already uses `credentials: true` when `FRONTEND_URL` lists the SPA origin.
- Cookie flags: **`httpOnly`**, **`secure` in production**, **`sameSite: lax`** by default. Override with optional `AUTH_COOKIE_SAME_SITE` (`lax` | `strict` | `none`; use `none` only if the SPA and API are on unrelated sites and you serve HTTPS).
- `POST /auth/sign-out` clears the cookie. Tokens are **not** returned to the browser in JSON (except legacy Postman flows using `Authorization: Bearer`).

## Xendit

- `XENDIT_SECRET_KEY`: **secret API key** for `api.xendit.co` (Basic auth) for invoices and payouts. Enable **Account Write** on the key for xenPlatform (`POST /v2/accounts`, Owned sub-account per brand after first successful fund). **Without it**, `POST /brands/campaigns/:id/checkout` returns **503** with `success: false` and a message that Xendit is not configured (no checkout session is created).
- `XENDIT_MASTER_USER_ID`: xenPlatform **master** `user_id` (from the Xendit dashboard). Required to `POST /transfers` the first fund from master → brand sub-account after checkout on master. `for-user-id` on invoices/payouts is only used when the sub-account status is **LIVE** (set via API or `account.created` webhook).
- `XENDIT_WEBHOOK_TOKEN`: callback verification token (`x-callback-token` on `POST /webhooks/xendit`). See **`.env.example`** for the full dashboard checklist. Register **one URL** (e.g. `https://{API}/webhooks/xendit`) for **INVOICES**, **DISBURSEMENT** (Payouts v2), **xenPlatform** (`account.created`), and **`split.payment`** (master → sub split after settlement). **Campaign funding** is applied when the invoice webhook succeeds or when the brand uses **Apply credit** (`POST /brands/campaigns/:id/checkout/:externalId/sync`) — that sync does **not** mark split settled; see [testing-refund-without-settlement-wait.md](./testing-refund-without-settlement-wait.md). The browser redirect alone does not credit the campaign.
- VidU checkout uses **`POST /v2/invoices`**, not Payment Requests v2. Invoice webhooks must use `external_id` prefixed `fund_` and `status: PAID`. Payout webhooks settle creator releases and brand refunds (`POST /v2/payouts`, `reference_id` = refund attempt UUID). If only Invoices are configured, brand refunds stay **Refund in progress** with no payout webhook log.
- **Local dev without `XENDIT_SECRET_KEY`:** Brand refunds complete **in-process** (no Xendit API call, no payout webhook). Set `XENDIT_SECRET_KEY` and expose `POST /webhooks/xendit` (ngrok/cloudflared) to test real disbursements and payout callbacks.
- **Pending / failed invoice webhooks:** Optional for crediting. Only **PAID** is required to auto-deposit; expired/failed checkouts are reconciled when the brand opens the Budget tab (transaction list polls Xendit) or uses **Apply credit** on “Payment received” rows. Adding pending/failed invoice webhooks would only speed up UI status — not required if you rely on sync + refresh.
- **Xendit Dashboard → Webhook logs** record **HTTP delivery** to your URL (2xx = completed for that attempt). **Apply credit does not update those logs** — it never triggers a webhook. After Apply credit, a **manual resend** or automatic retry should return **2xx** (payment already in ledger; idempotent) and show completed for that delivery without double-crediting. Earlier failed attempts stay failed in history; that is expected.
- **Invoice redirects:** checkout uses `success_redirect_url` / `failure_redirect_url` on the first `FRONTEND_URL` origin (`/brand/campaigns/:id?tab=budget&funding=success|failed`). Add those URLs in the Xendit dashboard if required for your account.

## OAuth (TikTok / Meta)

- **TikTok:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and `TIKTOK_REDIRECT_URI` (must match Login Kit redirect URI in the developer portal). TikTok does **not** allow `http://localhost` callbacks — use an **HTTPS tunnel** (e.g. `ngrok http 3001`) and set `TIKTOK_REDIRECT_URI` to `https://<tunnel>/oauth/tiktok/callback`. PKCE `code_verifier` is embedded in the signed `state` JWT (cookie is a fallback). Flow: `GET /oauth/tiktok/start` (Bearer) → TikTok → `GET /oauth/tiktok/callback` on the **tunnel host** → redirect to `FRONTEND_URL` (`http://localhost:5173` is fine for the SPA). Keep `VITE_API_URL` on `http://localhost:3001` if the tunnel forwards to the same API process.
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
- **`PUBLIC_OBJECT_BASE_URL`:** public origin (no trailing slash) used to build **`publicUrl`** and campaign card URLs; configure your R2 bucket or CDN so objects at `objectKey` are readable at that origin. When unset, the API returns **short-lived signed GET URLs** for brand campaign covers (list/detail) so local dev still shows images.
- **R2 bucket CORS (required for browser cover upload):** In Cloudflare R2 → your bucket → **Settings → CORS**, allow `PUT` from your SPA origins (e.g. `http://localhost:5173`, `https://www.app.vid-u.com`). Example rule: methods `PUT`, `GET`, `HEAD`; allowed origins your `FRONTEND_URL` entries; allowed headers `Content-Type`. Without this, `POST /uploads/presign` succeeds but the browser **`PUT` to `uploadUrl` fails** (Network tab shows the storage request in red).
- **Tuning (optional env, defaults in `src/config/uploads-r2.ts`):** `UPLOAD_PRESIGN_EXPIRES_SEC`, `UPLOAD_MAX_BYTES` (client-side expectation; enforce size in bucket policy / WAF as well).

## Webapp

- In `vidu-webapp`, set `VITE_API_URL` to the backend base (e.g. `http://localhost:3001`) so the SPA uses real auth endpoints when configured.

## Admin

- **`ADMIN_BASIC_PASSWORD`:** required to enable `/admin/*`. The API expects **`Authorization: Basic`** (username + password, Base64). Use HTTPS in production.
- **`ADMIN_BASIC_USER`:** optional; defaults to **`admin`** if unset.
- **`ADMIN_PRINCIPALS`**, **`ADMIN_JWT_CLAIM`:** defined in env schema for future use; **not read by the server** in the current build.

## Brand campaign limits (optional)

- Defaults are in **`src/config/campaign-limits.ts`** (via `src/config/read-env.ts`). Override with **`MIN_BRAND_RATE_PER_1K`** and **`MIN_PUBLISH_PHP`** (minimum brand payment to fund / publish) when needed.

## Fees / auto-pause pool floor (optional)

- Defaults in **`src/config/fees.ts`**. Override **`PLATFORM_DEPOSIT_FEE_PERCENT`** and **`CREATOR_PAYOUT_FEE_PERCENT`** when needed. The net spendable floor for auto-pause / resume is derived from **`MIN_PUBLISH_PHP`** and the deposit fee (not a separate env var).
