import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../utils/errors.js";
import type { UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

/** Requires the authed user to have a `user_role_profile` row for this role (DB source of truth). */
export function requireDbRole(...roles: UserRole[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = req.authUser?.id;
      if (!uid) {
        next(new ForbiddenError("Unauthorized"));
        return;
      }
      const profiles = await prisma.userRoleProfile.findMany({ where: { userId: uid } });
      const ok = roles.some((r) => profiles.some((p) => p.role === r));
      if (!ok) {
        next(new ForbiddenError(`Requires role: ${roles.join(" or ")}`));
        return;
      }
      const full = await prisma.user.findUniqueOrThrow({
        where: { id: uid },
        include: { roleProfiles: true },
      });
      req.dbUser = full;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireHasAnyDbRole() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = req.authUser?.id;
      if (!uid) {
        next(new ForbiddenError("Unauthorized"));
        return;
      }
      const profiles = await prisma.userRoleProfile.findMany({ where: { userId: uid } });
      if (profiles.length === 0) {
        next(new ForbiddenError("No role selected"));
        return;
      }
      const full = await prisma.user.findUniqueOrThrow({
        where: { id: uid },
        include: { roleProfiles: true },
      });
      req.dbUser = full;
      next();
    } catch (e) {
      next(e);
    }
  };
}
