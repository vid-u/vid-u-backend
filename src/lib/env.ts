import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  FRONTEND_URL: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  /** Server-only; never expose to clients */
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /** Public URL for avatar/logo keys (no trailing slash). */
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  /** Resend API key (https://resend.com/api-keys). Replace placeholder with your real key. */
  RESEND_API_KEY: z.string().optional(),
  /** From address Resend accepts (verified domain or onboarding@resend.dev for testing). */
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  /** Absolute URL for the logo in HTML emails (optional; else first `FRONTEND_URL` origin + `/email-logo.svg`). */
  EMAIL_LOGO_URL: z.string().url().optional(),
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
