import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Comma-separated origins allowed for CORS. */
  FRONTEND_URL: z.string().optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** HS256 secret for local JWT verification (optional; otherwise JWKS RS256). */
  SUPABASE_JWT_SECRET: z.string().optional(),
  /** Defaults to `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` when SUPABASE_URL is set. */
  SUPABASE_JWKS_URL: z.string().url().optional(),

  XENDIT_SECRET_KEY: z.string().optional(),
  XENDIT_WEBHOOK_TOKEN: z.string().optional(),
  /** xenPlatform master `user_id` — source for master → sub-account transfers. */
  XENDIT_MASTER_USER_ID: z.string().optional(),

  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v21.0"),
  META_REDIRECT_URI: z.string().url().optional(),
  /** Comma-separated OAuth scopes; must match permissions enabled on the Meta app. */
  META_OAUTH_SCOPES: z.string().optional(),

  /** First 32 UTF-8 bytes used as HS256 key for OAuth `state` JWT (fallback: TOKEN_ENCRYPTION_KEY hex). */
  OAUTH_STATE_SECRET: z.string().min(32).optional(),

  /** Comma-separated admin emails or user ids for admin routes (MVP). */
  ADMIN_PRINCIPALS: z.string().optional(),
  /** HTTP Basic password for `/admin/*` (empty disables admin routes except 403). */
  ADMIN_BASIC_PASSWORD: z.string().optional(),
  /** HTTP Basic username for `/admin/*` (default `admin`). */
  ADMIN_BASIC_USER: z.string().optional(),
  /** Optional JWT claim name carrying admin flag (future). */
  ADMIN_JWT_CLAIM: z.string().optional(),

  /** 64-char hex (32 bytes) for AES-256-GCM token/account encryption. */
  TOKEN_ENCRYPTION_KEY: z.string().length(64).optional(),

  /**
   * Public origin for object keys (no trailing slash). Used in campaign cards and
   * `POST /uploads/presign` `publicUrl` when set.
   */
  PUBLIC_OBJECT_BASE_URL: z.string().url().optional(),

  /** Public URL of this API (OAuth redirect_uri). Defaults to http://localhost:${PORT}. */
  PUBLIC_API_URL: z.string().url().optional(),

  /** R2 S3 API endpoint, e.g. `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. */
  R2_S3_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export function getPublicApiUrl(): string {
  return env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`;
}

export function getSupabaseJwksUrl(): string | undefined {
  if (env.SUPABASE_JWKS_URL) return env.SUPABASE_JWKS_URL;
  if (env.SUPABASE_URL) {
    return `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  }
  return undefined;
}

