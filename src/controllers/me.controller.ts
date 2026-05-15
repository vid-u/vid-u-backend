import type { Request, Response } from "express";
import { ForbiddenError } from "../utils/errors.js";
import { sendSuccess } from "../utils/api-response.js";
import { paramString } from "../lib/params.js";
import type { Platform } from "../generated/prisma/enums.js";
import type { PatchMeBodyDto, PutMeRoleBodyDto } from "../validation/me.schema.js";
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
  const rows = await listMePlatformAccounts(req.dbUser!.id);
  sendSuccess(res, {
    platformLinks: rows.map((r) => ({
      platform: r.platform,
      displayHandle: r.displayHandle,
      linkStatus: r.linkStatus,
      connectedAt: r.connectedAt?.toISOString() ?? null,
    })),
  });
}

export async function deleteMePlatform(req: Request, res: Response): Promise<void> {
  await deleteMePlatformAccount(req.dbUser!.id, paramString(req.params.platform) as Platform);
  sendSuccess(res, { ok: true });
}
