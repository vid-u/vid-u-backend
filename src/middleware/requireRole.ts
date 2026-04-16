import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

export function requireRole(...allowed: UserRole[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.authUser?.id) {
        next(new UnauthorizedError());
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: req.authUser.id },
      });
      if (!user) {
        next(new UnauthorizedError("User not found in database"));
        return;
      }
      if (!allowed.includes(user.role)) {
        next(new ForbiddenError(`Requires role: ${allowed.join(" or ")}`));
        return;
      }
      req.dbUser = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}
