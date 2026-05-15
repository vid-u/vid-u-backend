import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../generated/prisma/enums.js";
import { extractBearer, verifySupabaseJwt } from "../lib/supabase-auth.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";
import { ensureUserFromJwt, readViduRoleFromJwt } from "../services/user.service.js";

/**
 * Verifies JWT and ensures `user` row exists (id = auth.users.id).
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new UnauthorizedError("Missing bearer token");
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
