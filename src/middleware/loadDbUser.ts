import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { UnauthorizedError } from "../utils/errors.js";

export async function loadDbUser(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.authUser?.id) {
      next(new UnauthorizedError());
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.authUser.id },
    });
    if (!user) {
      next(
        new UnauthorizedError(
          "User not found — call POST /auth/sync with your Supabase session"
        )
      );
      return;
    }
    req.dbUser = user;
    next();
  } catch (e) {
    next(e);
  }
}
