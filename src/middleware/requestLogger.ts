import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME } from "../lib/auth-cookie.js";
import { logger } from "../utils/logger.js";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const path = req.originalUrl.split("?")[0] ?? req.path;
    const isAuthPath =
      path.startsWith("/auth") || path === "/me" || path.startsWith("/me/");
    const entry: Record<string, string | number | boolean | undefined> = {
      method: req.method,
      path,
      status: res.statusCode,
      ms,
    };
    if (isAuthPath) {
      const origin = req.get("origin");
      if (origin) entry.origin = origin;
      entry.hasSessionCookie = Boolean(req.cookies?.[SESSION_COOKIE_NAME]);
    }
    logger.info("request", entry);
  });
  next();
}
