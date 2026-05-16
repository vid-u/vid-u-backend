import type { NextFunction, Request, Response } from "express";
import { AppError, ConflictError, ValidationError } from "../utils/errors.js";
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
      ...((err instanceof ValidationError || err instanceof ConflictError) &&
      err.errors !== undefined
        ? { errors: err.errors }
        : {}),
    });
    return;
  }

  const detail = err instanceof Error ? err.message : String(err);
  logger.error("Unhandled error", {
    error: detail,
    stack: err instanceof Error ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    message: "Something went wrong. Please try again.",
  });
}
