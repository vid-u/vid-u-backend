import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    logger.info("request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
    });
  });
  next();
}
