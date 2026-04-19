import type { Request, Response } from "express";
import * as paymentMethodService from "../services/payment-method.service.js";
import { sendSuccess } from "../utils/api-response.js";

export async function getPaymentMethods(req: Request, res: Response): Promise<void> {
  const result = await paymentMethodService.listPaymentMethods(req.dbUser!.id);
  sendSuccess(res, result, "ok");
}

export async function postPaymentMethod(req: Request, res: Response): Promise<void> {
  const result = await paymentMethodService.addPaymentMethod(req.dbUser!.id, req.body);
  sendSuccess(res, result, "Payment method added", 201);
}

export async function postPaymentMethodDefault(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const result = await paymentMethodService.setDefaultPaymentMethod(req.dbUser!.id, id);
  sendSuccess(res, result, "Default payment method updated");
}

export async function deletePaymentMethod(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await paymentMethodService.deletePaymentMethod(req.dbUser!.id, id);
  sendSuccess(res, { deleted: true }, "Payment method removed");
}
