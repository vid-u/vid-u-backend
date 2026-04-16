import type { Request, Response } from "express";
import * as activitiesService from "../services/activities.service.js";
import * as campaignService from "../services/campaign.service.js";
import type {
  ListClientCampaignsQueryDto,
  ListPublicCampaignsQueryDto,
} from "../validation/campaign.schema.js";
import type { ListActivitiesQueryDto } from "../validation/activities.schema.js";
import { sendSuccess } from "../utils/api-response.js";

export async function getCampaignsPublic(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListPublicCampaignsQueryDto;
  const { campaigns, meta } = await campaignService.listPublicCampaigns(q);
  sendSuccess(res, campaigns, "ok", 200, meta);
}

export async function getCampaignsMine(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListClientCampaignsQueryDto;
  const { campaigns, meta } = await campaignService.listCampaigns({
    authUserId: req.dbUser!.id,
    authRole: req.dbUser!.role,
    mine: true,
    page: q.page,
    limit: q.limit,
  });
  sendSuccess(res, campaigns, "ok", 200, meta);
}

export async function postCampaign(req: Request, res: Response): Promise<void> {
  const row = await campaignService.createDraftCampaign(req.dbUser!.id, req.body);
  sendSuccess(res, row, "Draft campaign created", 201);
}

export async function getCampaignById(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const row = await campaignService.getCampaignForViewer(id, {
    userId: req.dbUser!.id,
    role: req.dbUser!.role,
  });
  sendSuccess(res, row, "ok");
}

/** `GET /campaigns/:id/activities` (tester) or `GET /client/campaigns/:campaignId/activities` (client). */
export async function getCampaignActivities(req: Request, res: Response): Promise<void> {
  const campaignId =
    typeof req.params.campaignId === "string"
      ? req.params.campaignId
      : (req.params as { id: string }).id;
  const q = req.query as unknown as ListActivitiesQueryDto;
  const { activities, meta } = await activitiesService.getCampaignActivities(
    campaignId,
    { userId: req.dbUser!.id, role: req.dbUser!.role },
    q.page,
    q.limit,
  );
  sendSuccess(res, activities, "ok", 200, meta);
}

export async function patchCampaignById(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const row = await campaignService.patchCampaign(
    id,
    req.dbUser!.id,
    req.body
  );
  sendSuccess(res, row, "updated");
}

export async function postFundCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const result = await campaignService.fundCampaign(
    id,
    req.dbUser!.id,
    req.body
  );
  sendSuccess(res, result, "Campaign funded");
}

export async function postTopUpCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const result = await campaignService.topUpCampaign(
    id,
    req.dbUser!.id,
    req.body
  );
  sendSuccess(res, result, "Top-up recorded");
}

export async function postCloseCampaign(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const result = await campaignService.closeCampaign(
    id,
    req.dbUser!.id,
    req.body?.closeTxSignature
  );
  sendSuccess(res, result, "Campaign ended");
}
