import type { Request, Response } from "express";
import { ValidationError } from "../utils/errors.js";
import { sendSuccess } from "../utils/api-response.js";
import {
  putMeBrandProfileBodySchema,
  putMeCreatorProfileBodySchema,
} from "../validation/me-profile.schema.js";
import {
  getMeProfilePayload,
  primaryRoleFromProfiles,
  putMeBrandProfile,
} from "../services/session-profile.service.js";
import {
  getBrandLedgerByMonth,
  getBrandLedgerByYear,
  getCreatorEarningsByMonth,
  getCreatorEarningsByYear,
} from "../services/user-analytics.service.js";

export async function getMeProfile(req: Request, res: Response): Promise<void> {
  const role = primaryRoleFromProfiles(req.dbUser?.roleProfiles);
  sendSuccess(res, await getMeProfilePayload(req.dbUser!.id, role));
}

export async function putMeProfile(req: Request, res: Response): Promise<void> {
  const userId = req.dbUser!.id;
  const role = primaryRoleFromProfiles(req.dbUser?.roleProfiles);

  if (role === "creator") {
    const parsed = putMeCreatorProfileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid body", parsed.error.flatten());
    }
    sendSuccess(res, await getMeProfilePayload(userId, role));
    return;
  }

  const parsed = putMeBrandProfileBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError("Invalid body", parsed.error.flatten());
  }
  await putMeBrandProfile(userId, parsed.data);
  sendSuccess(res, await getMeProfilePayload(userId, role));
}

export async function getMeAnalytics(req: Request, res: Response): Promise<void> {
  const userId = req.dbUser!.id;
  const role = primaryRoleFromProfiles(req.dbUser?.roleProfiles);

  if (role === "creator") {
    const [monthly, yearly] = await Promise.all([
      getCreatorEarningsByMonth(userId),
      getCreatorEarningsByYear(userId),
    ]);
    sendSuccess(res, { monthly, yearly });
    return;
  }

  const [monthly, yearly] = await Promise.all([getBrandLedgerByMonth(userId), getBrandLedgerByYear(userId)]);
  sendSuccess(res, { monthly, yearly });
}
