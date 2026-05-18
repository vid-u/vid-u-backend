import type { Request, Response } from "express";
import { ForbiddenError } from "../utils/errors.js";
import { sendSuccess } from "../utils/api-response.js";
import { paramString } from "../lib/params.js";
import type { Platform } from "../generated/prisma/enums.js";
import type { PatchMeBodyDto, PutMeRoleBodyDto } from "../validation/me.schema.js";
import { syncFacebookPageLinkage } from "../services/meta-platform.service.js";
import { mapCreatorPlatformLinkDto } from "../services/session-profile.service.js";
import {
  buildMeResponseData,
  completeMeOnboarding,
  deleteMePlatformAccount,
  listMePlatformAccounts,
  patchMeUser,
  setInitialUserRole,
} from "../services/session-user.service.js";

export async function getMe(req: Request, res: Response): Promise<void> {
  sendSuccess(res, buildMeResponseData(req.dbUser!));
}

export async function patchMe(req: Request, res: Response): Promise<void> {
  const user = await patchMeUser(req.dbUser!.id, req.body as PatchMeBodyDto);
  sendSuccess(res, buildMeResponseData(user));
}

export async function putMeRole(req: Request, res: Response): Promise<void> {
  const { dbUser, role } = await setInitialUserRole(req.dbUser!.id, req.body as PutMeRoleBodyDto);
  req.dbUser = dbUser;
  sendSuccess(res, { role });
}

export async function postMeOnboardingComplete(req: Request, res: Response): Promise<void> {
  const profiles = req.dbUser!.roleProfiles;
  if (profiles.length !== 1) {
    throw new ForbiddenError("Select exactly one role before completing onboarding");
  }
  const role = profiles[0]!.role;
  await completeMeOnboarding(req.dbUser!.id, role);
  sendSuccess(res, { profileOnboardingComplete: true, role });
}

export async function getMePlatforms(req: Request, res: Response): Promise<void> {
  const userId = req.dbUser!.id;
  try {
    await syncFacebookPageLinkage(userId);
  } catch {
    /* keep last known linkage if Meta is temporarily unavailable */
  }
  const rows = await listMePlatformAccounts(userId);
  sendSuccess(res, {
    platformLinks: rows.map(mapCreatorPlatformLinkDto),
  });
}

export async function deleteMePlatform(req: Request, res: Response): Promise<void> {
  await deleteMePlatformAccount(req.dbUser!.id, paramString(req.params.platform) as Platform);
  sendSuccess(res, { ok: true });
}
