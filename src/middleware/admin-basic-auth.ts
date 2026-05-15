import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../lib/env.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

function ctEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireAdminBasicAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const password = env.ADMIN_BASIC_PASSWORD ?? "";
  if (password === "") {
    next(new ForbiddenError("Admin API not configured"));
    return;
  }

  const expectedUser = env.ADMIN_BASIC_USER ?? "admin";
  const authz = req.headers.authorization;
  if (typeof authz !== "string" || !authz.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VidU Admin"');
    next(new UnauthorizedError("Unauthorized"));
    return;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authz.slice(6).trim(), "base64").toString("utf8");
  } catch {
    res.setHeader("WWW-Authenticate", 'Basic realm="VidU Admin"');
    next(new UnauthorizedError("Unauthorized"));
    return;
  }

  const idx = decoded.indexOf(":");
  if (idx === -1) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VidU Admin"');
    next(new UnauthorizedError("Unauthorized"));
    return;
  }

  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  if (!ctEqual(user, expectedUser) || !ctEqual(pass, password)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VidU Admin"');
    next(new UnauthorizedError("Invalid admin credentials"));
    return;
  }

  next();
}
