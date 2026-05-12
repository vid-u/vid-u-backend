import type { Request, Response } from "express";
import * as waitlistService from "../services/waitlist.service.js";
import type { WaitlistDto } from "../validation/waitlist.schema.js";
import { sendSuccess } from "../utils/api-response.js";

export async function getWaitlist(_req: Request, res: Response): Promise<void> {
  const data = await waitlistService.getWaitlistCounts();
  sendSuccess(res, data);
}

export async function postWaitlist(req: Request, res: Response): Promise<void> {
  const body = req.body as WaitlistDto;
  const result = await waitlistService.addToWaitlist(body);
  if (result.alreadyWhitelisted) {
    sendSuccess(
      res,
      result,
      "This email is already whitelisted.",
      200,
    );
    return;
  }

  sendSuccess(res, result, "Added to waitlist", 201);
}
