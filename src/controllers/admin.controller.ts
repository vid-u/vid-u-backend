import type { Request, Response } from "express";
import { sendSuccess } from "../utils/api-response.js";
import { paramString } from "../lib/params.js";
import type { AdminLedgerAdjustBodyDto } from "../validation/admin.schema.js";
import * as admin from "../services/admin.service.js";

export async function postReconcileCampaign(req: Request, res: Response): Promise<void> {
  const data = await admin.reconcileCampaignBudgets(paramString(req.params.id));
  sendSuccess(res, data);
}

export async function postLedgerAdjust(req: Request, res: Response): Promise<void> {
  const result = await admin.adminLedgerAdjust(paramString(req.params.id), req.body as AdminLedgerAdjustBodyDto);
  if (result.duplicate) {
    sendSuccess(res, { duplicate: true });
    return;
  }
  sendSuccess(res, { ok: true });
}

export async function postForceRejectSubmission(req: Request, res: Response): Promise<void> {
  await admin.adminForceRejectSubmission(paramString(req.params.id));
  sendSuccess(res, { ok: true });
}

export async function getAuditCampaign(req: Request, res: Response): Promise<void> {
  const data = await admin.adminAuditCampaign(paramString(req.params.id));
  sendSuccess(res, data);
}
