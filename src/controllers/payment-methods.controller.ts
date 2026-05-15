import type { Request, Response } from "express";
import { paramString } from "../lib/params.js";
import { ForbiddenError } from "../utils/errors.js";
import { sendSuccess } from "../utils/api-response.js";
import {
  createPaymentMethodForUser,
  deletePaymentMethodForUser,
  listPaymentMethodsForUser,
  patchPaymentMethodForUser,
  purposeFromUserRole,
} from "../services/payment-methods.service.js";
import type { PatchPaymentMethodBodyDto, PostPaymentMethodBodyDto } from "../validation/payment-methods.schema.js";

function resolvePurpose(req: Request) {
  const role = req.authUser?.role;
  if (role !== "brand" && role !== "creator") {
    throw new ForbiddenError("Select a role before managing payment methods");
  }
  return purposeFromUserRole(role);
}

export async function getPaymentMethods(req: Request, res: Response): Promise<void> {
  const userId = req.dbUser!.id;
  const purpose = resolvePurpose(req);
  const items = await listPaymentMethodsForUser(userId, purpose);
  sendSuccess(res, { items });
}

export async function postPaymentMethod(req: Request, res: Response): Promise<void> {
  const userId = req.dbUser!.id;
  const purpose = resolvePurpose(req);
  const body = req.body as PostPaymentMethodBodyDto;
  const method = await createPaymentMethodForUser(userId, purpose, body);
  sendSuccess(res, { method }, "ok", 201);
}

export async function patchPaymentMethod(req: Request, res: Response): Promise<void> {
  const userId = req.dbUser!.id;
  const purpose = resolvePurpose(req);
  const methodId = paramString(req.params.id);
  const body = req.body as PatchPaymentMethodBodyDto;
  const method = await patchPaymentMethodForUser(userId, purpose, methodId, body);
  sendSuccess(res, { method });
}

export async function deletePaymentMethod(req: Request, res: Response): Promise<void> {
  const userId = req.dbUser!.id;
  const purpose = resolvePurpose(req);
  const methodId = paramString(req.params.id);
  await deletePaymentMethodForUser(userId, purpose, methodId);
  sendSuccess(res, { ok: true });
}
