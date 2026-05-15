import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export function getSupabaseAnonClient(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase auth is not configured (SUPABASE_URL / SUPABASE_ANON_KEY)");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getSupabaseServiceClient(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase service role is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
