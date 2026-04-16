import type { Request, Response } from "express";
import { UserRole } from "../generated/prisma/enums.js";
import * as authService from "../services/auth.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { UnauthorizedError } from "../utils/errors.js";

export async function postSync(req: Request, res: Response): Promise<void> {
  const authUserId = req.authUser?.id;
  if (!authUserId) {
    throw new UnauthorizedError();
  }
  const result = await authService.syncUserFromSession({
    authUserId,
    walletAddress: req.body.walletAddress,
    role: req.body.role as UserRole | undefined,
  });
  sendSuccess(res, result, "Profile synced");
}
