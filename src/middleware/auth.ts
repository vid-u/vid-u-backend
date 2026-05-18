import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../generated/prisma/enums.js";
import { extractSessionToken, SESSION_COOKIE_NAME } from "../lib/auth-cookie.js";
import { authRequestContext } from "../lib/auth-request-log.js";
import { verifySupabaseJwt } from "../lib/supabase-auth.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";
import { ensureUserFromJwt, readViduRoleFromJwt } from "../services/user.service.js";
import { logger } from "../utils/logger.js";

/**
 * Verifies JWT and ensures `user` row exists (id = auth.users.id).
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractSessionToken(req);
    if (!token) {
      if (req.originalUrl.startsWith("/me")) {
        logger.warn("GET /me unauthorized — no session", {
          ...authRequestContext(req),
          reason: "missing_session",
        });
      }
      throw new UnauthorizedError("Missing session");
    }
    const payload = await verifySupabaseJwt(token);
    const dbUser = await ensureUserFromJwt(payload);
    const roleFromDb = dbUser.roleProfiles[0]?.role;
    const role =
      roleFromDb === "brand" || roleFromDb === "creator"
        ? roleFromDb
        : readViduRoleFromJwt(payload);
    req.authUser = {
      id: dbUser.id,
      email: dbUser.email ?? undefined,
      role,
    };
    req.dbUser = dbUser;
    next();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      next(e);
      return;
    }
    if (req.originalUrl.startsWith("/me")) {
      logger.warn("GET /me unauthorized — invalid session", {
        ...authRequestContext(req),
        reason: "invalid_or_expired_token",
        hadSessionCookie: Boolean(req.cookies?.[SESSION_COOKIE_NAME]),
        error: e instanceof Error ? e.message : "unknown",
      });
    }
    next(new UnauthorizedError("Invalid or expired token"));
  }
}

export function requireRole(...allowed: UserRole[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.dbUser) throw new UnauthorizedError();
      const profiles = req.dbUser.roleProfiles.map((p) => p.role);
      const ok = allowed.some((r) => profiles.includes(r));
      if (!ok) throw new ForbiddenError(`Requires role: ${allowed.join(" or ")}`);
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireAnyRole() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.dbUser?.roleProfiles?.length) {
        throw new ForbiddenError("No role selected");
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
