import type { Request, Response } from "express";
import { ConflictError } from "../utils/errors.js";
import { sendSuccess } from "../utils/api-response.js";
import { paramString } from "../lib/params.js";
import type {
  BrandCheckoutSessionBodyDto,
  BrandRejectSubmissionBodyDto,
  CreateBrandCampaignBodyDto,
  PatchBrandCampaignBodyDto,
} from "../validation/brands-campaigns.schema.js";
import * as brandCampaigns from "../services/brands-campaigns.service.js";

export async function listBrandCampaigns(req: Request, res: Response): Promise<void> {
  const items = await brandCampaigns.listBrandCampaignCardsForUser(req.dbUser!.id);
  sendSuccess(res, { items });
}

export async function createBrandCampaign(req: Request, res: Response): Promise<void> {
  const dto = await brandCampaigns.createBrandCampaignForUser(
    req.dbUser!.id,
    req.body as CreateBrandCampaignBodyDto,
  );
  sendSuccess(res, { campaign: dto }, "ok", 201);
}

export async function getBrandCampaign(req: Request, res: Response): Promise<void> {
  const dto = await brandCampaigns.getBrandCampaignDtoForUser(req.dbUser!.id, paramString(req.params.id));
  sendSuccess(res, { campaign: dto });
}

export async function postCheckoutSession(req: Request, res: Response): Promise<void> {
  const out = await brandCampaigns.createBrandCheckoutSession(
    req.dbUser!.id,
    paramString(req.params.id),
    req.body as BrandCheckoutSessionBodyDto,
  );
  sendSuccess(res, out);
}

export async function postPayoutReleases(req: Request, res: Response): Promise<void> {
  const result = await brandCampaigns.releasePayoutsForCampaign(
    req.dbUser!.id,
    paramString(req.params.id),
  );
  if (result.type === "nothing") {
    throw new ConflictError("nothing_to_pay");
  }
  brandCampaigns.startPayoutReleaseWorker(result.ids);
  sendSuccess(res, { released: result.count });
}

export async function postBrandRejectSubmission(req: Request, res: Response): Promise<void> {
  await brandCampaigns.rejectBrandSubmission(
    req.dbUser!.id,
    paramString(req.params.id),
    paramString(req.params.submissionId),
    req.body as BrandRejectSubmissionBodyDto,
  );
  sendSuccess(res, { ok: true });
}

export async function postCampaignRefund(req: Request, res: Response): Promise<void> {
  const out = await brandCampaigns.refundAvailableCampaignBalance(
    req.dbUser!.id,
    paramString(req.params.id),
  );
  sendSuccess(res, out);
}

export async function patchBrandCampaign(req: Request, res: Response): Promise<void> {
  const dto = await brandCampaigns.patchBrandCampaignForUser(
    req.dbUser!.id,
    paramString(req.params.id),
    req.body as PatchBrandCampaignBodyDto,
  );
  sendSuccess(res, { campaign: dto });
}
