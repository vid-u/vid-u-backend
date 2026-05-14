import type { Request, Response } from "express";
import * as healthService from "../services/health.service.js";
import { sendSuccess } from "../utils/api-response.js";

export function getLiveness(_req: Request, res: Response): void {
  sendSuccess(
    res,
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    "Server is healthy",
  );
}

export async function getReady(_req: Request, res: Response): Promise<void> {
  await healthService.pingDatabase();
  sendSuccess(res, { database: "up" }, "Ready");
}
