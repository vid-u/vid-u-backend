import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { ZodError } from "zod";
import { ValidationError } from "../utils/errors.js";

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.body ?? {};
      req.body = await schema.parseAsync(raw);
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        next(new ValidationError("Validation failed", e.flatten()));
        return;
      }
      next(e);
    }
  };
}

export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.params = (await schema.parseAsync(req.params)) as Request["params"];
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        next(new ValidationError("Validation failed", e.flatten()));
        return;
      }
      next(e);
    }
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.query = (await schema.parseAsync(req.query)) as Request["query"];
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        next(new ValidationError("Validation failed", e.flatten()));
        return;
      }
      next(e);
    }
  };
}
