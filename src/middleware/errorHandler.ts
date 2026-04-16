import type { NextFunction, Request, Response } from "express";
import { AppError, ValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err instanceof ValidationError && err.errors !== undefined
        ? { errors: err.errors }
        : {}),
    });
    return;
  }

  logger.error("Unhandled error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err instanceof Error
        ? err.message
        : "Internal server error";

  res.status(500).json({
    success: false,
    message,
  });
}
