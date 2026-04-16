import type { NextFunction, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.js";
import { UnauthorizedError } from "../utils/errors.js";

let supabaseAdmin: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdmin;
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      next(new UnauthorizedError("No bearer token"));
      return;
    }

    const admin = getSupabaseAdmin();
    if (admin) {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data.user) {
        req.authUser = {
          id: data.user.id,
          email: data.user.email ?? undefined,
        };
        next();
        return;
      }
    }

    if (!admin) {
      next(
        new UnauthorizedError(
          "Auth is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
        )
      );
      return;
    }

    next(new UnauthorizedError("Invalid or expired session"));
  } catch (e) {
    next(e);
  }
}
