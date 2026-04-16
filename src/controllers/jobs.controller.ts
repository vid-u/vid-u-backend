import type { Request, Response } from "express";
import { env } from "../lib/env.js";
import * as jobsService from "../services/jobs.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { ForbiddenError } from "../utils/errors.js";

export async function postCheckExpired(req: Request, res: Response): Promise<void> {
  const secret = req.headers["x-cron-secret"];
  const s = typeof secret === "string" ? secret : Array.isArray(secret) ? secret[0] : "";
  if (env.CRON_SECRET) {
    if (s !== env.CRON_SECRET) {
      throw new ForbiddenError("Invalid x-cron-secret");
    }
  } else if (env.NODE_ENV === "production") {
    throw new ForbiddenError("Set CRON_SECRET in production");
  }
  const result = await jobsService.runCheckExpired();
  sendSuccess(res, { ...result, warning: env.CRON_SECRET ? undefined : "CRON_SECRET not set — allowed in non-production only" }, "check-expired");
}
