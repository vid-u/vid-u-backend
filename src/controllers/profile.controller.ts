import type { Request, Response } from "express";
import * as profileService from "../services/profile.service.js";
import { sendSuccess } from "../utils/api-response.js";

export async function getClientProfile(req: Request, res: Response): Promise<void> {
  const data = await profileService.getClientProfilePayload(
    req.dbUser!.id,
    req.authUser?.email,
  );
  sendSuccess(res, data, "ok");
}

export async function patchClientProfile(req: Request, res: Response): Promise<void> {
  const data = await profileService.updateClientProfile(
    req.dbUser!.id,
    req.body,
    req.authUser?.email,
  );
  sendSuccess(res, data, "updated");
}

export async function getTesterProfile(req: Request, res: Response): Promise<void> {
  const data = await profileService.getTesterProfilePayload(req.dbUser!.id);
  sendSuccess(res, { profile: data }, "ok");
}

export async function patchTesterProfile(req: Request, res: Response): Promise<void> {
  const data = await profileService.updateTesterProfile(req.dbUser!.id, req.body);
  sendSuccess(res, { profile: data }, "updated");
}

export async function getTesterWorkPreferences(req: Request, res: Response): Promise<void> {
  const data = await profileService.getWorkPreferencesPayload(req.dbUser!.id);
  sendSuccess(res, data, "ok");
}

export async function patchTesterWorkPreferences(req: Request, res: Response): Promise<void> {
  const data = await profileService.updateWorkPreferences(req.dbUser!.id, req.body);
  sendSuccess(res, data, "updated");
}

export async function getTesterAvailability(req: Request, res: Response): Promise<void> {
  const data = await profileService.getAvailabilityPayload(req.dbUser!.id);
  sendSuccess(res, data, "ok");
}

export async function patchTesterAvailability(req: Request, res: Response): Promise<void> {
  const data = await profileService.updateAvailability(req.dbUser!.id, req.body);
  sendSuccess(res, data, "updated");
}
