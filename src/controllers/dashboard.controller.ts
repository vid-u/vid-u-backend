import type { Request, Response } from "express";
import * as dashboardService from "../services/dashboard.service.js";
import { sendSuccess } from "../utils/api-response.js";

export async function getClientDashboard(req: Request, res: Response): Promise<void> {
  const data = await dashboardService.getClientDashboard(req.dbUser!.id);
  sendSuccess(res, data, "ok");
}

export async function getTesterDashboard(req: Request, res: Response): Promise<void> {
  const data = await dashboardService.getTesterDashboard(req.dbUser!.id);
  sendSuccess(res, data, "ok");
}
