# Cloudflare R2 — file uploads

BugHyve uses **Cloudflare R2** with the **S3-compatible API**. The backend issues **presigned URLs** so the browser uploads/downloads directly to R2 without exposing secret keys.

## 1. Create bucket and API token

1. In [Cloudflare Dashboard](https://dash.cloudflare.com/) → **R2** → create a bucket (e.g. `bughyve-uploads`).
2. **Manage R2 API Tokens** → create a token with **Object Read & Write** on that bucket (or a scoped permission your org allows).
3. Note:
   - **Account ID** (R2 overview)
   - **Access Key ID** and **Secret Access Key** from the token
   - **Bucket name**

## 2. Environment variables

Set these on the server (see [`.env.example`](../.env.example)):

| Variable | Purpose |
|----------|---------|
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | Bucket name |
| `R2_PUBLIC_BASE_URL` | Public base URL for **avatars** and **client logos** (no trailing slash) |

`R2_PUBLIC_BASE_URL` is used to build **`publicUrl`** after a successful presigned upload for `purpose: avatar` and `purpose: client_logo`. Store that URL in `users.avatar_url` or `client_profiles.logo_url`.

## 3. Public reads for avatars & logos

Submission **evidence** stays **private** (only presigned GET). Avatars and client logos are intended to be **readable without signing** so the UI can show them on any page.

Configure **public access** for the path prefixes used by the API:

- `avatars/*`
- `clients/*`

Typical options:

1. **Custom domain** for the bucket (R2 → bucket → **Settings** → **Public access** / connect domain), then set `R2_PUBLIC_BASE_URL` to `https://your-domain.com` or the path your provider shows.
2. **R2.dev subdomain** (if enabled for the bucket) — use the public URL Cloudflare gives you as `R2_PUBLIC_BASE_URL`.

Ensure the bucket or **R2 bucket policy** allows **anonymous `GetObject`** only for those prefixes (not for `campaigns/`).

> Exact Cloudflare UI steps change over time; use the current R2 docs for “public bucket” or “custom domain”.

## 4. API behavior

### `POST /uploads/presign`

Body uses **`purpose`**:

| `purpose` | Who | Key pattern | After upload |
|-----------|-----|-------------|----------------|
| `avatar` | Any authenticated user | `avatars/{userId}/{uuid}-{filename}` | Response includes **`publicUrl`** if `R2_PUBLIC_BASE_URL` is set |
| `client_logo` | `role: client` | `clients/{userId}/logo/{uuid}-{filename}` | Same |
| `evidence` | `role: tester` | `campaigns/{campaignId}/submissions/{submissionId}/...` or `campaigns/{campaignId}/draft/{testerId}/...` | Store **`objectKey`** in `submissions.evidence_urls` (not the presigned URL) |

Evidence upload requires an **active** campaign with **escrow** initialized. Either attach to an existing submission (`submissionId`) or upload to **draft** (omit `submissionId`) before creating the submission.

### `POST /uploads/presign-download`

Body: `{ "objectKey": "<key>" }` — only for **evidence** keys under `campaigns/...`.

**Who can retrieve:**

| Key type | Tester | Client (campaign owner) |
|----------|--------|-------------------------|
| `campaigns/.../submissions/.../file` | Yes, if they submitted | Yes, if they own the campaign |
| `campaigns/.../draft/.../file` | Yes, own draft folder only | Yes, if they own the campaign |

Avatars and logos do **not** use this endpoint — use **`publicUrl`** from the presign response (or concatenate `R2_PUBLIC_BASE_URL` + `objectKey`).

## 5. CORS (browser uploads)

If the browser PUTs directly to R2, configure **CORS** on the bucket for your app origins (R2 bucket → **Settings** → **CORS**). Allow `PUT` (and `GET` if needed) from your frontend origin.

## 6. Troubleshooting

- **403 on presigned PUT**: check token permissions, bucket name, and endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
- **publicUrl 404 in browser**: public access not enabled for `avatars/` and `clients/`, or `R2_PUBLIC_BASE_URL` wrong.
- **Evidence download forbidden**: user must be the submission’s tester or the campaign’s client; draft keys allow the same tester **or** the campaign client.
