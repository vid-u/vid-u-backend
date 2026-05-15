import type { Request, Response } from "express";
import { NotFoundError } from "../utils/errors.js";
import { sendSuccess } from "../utils/api-response.js";
import { paramString } from "../lib/params.js";
import type { ListCampaignsQueryDto } from "../validation/campaigns-public.schema.js";
import {
  getDiscoverCampaignById,
  listDiscoverCampaigns,
} from "../services/campaigns-discover.service.js";

export async function listActiveCampaigns(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListCampaignsQueryDto;
  const items = await listDiscoverCampaigns(q);
  sendSuccess(res, {
    items,
    limit: 50,
    filters: {
      status: q.status,
      platform: q.platform ?? null,
      sort: q.sort,
    },
  });
}

export async function getActiveCampaign(req: Request, res: Response): Promise<void> {
  const dto = await getDiscoverCampaignById(paramString(req.params.id));
  if (!dto) throw new NotFoundError("Campaign not found");
  sendSuccess(res, { campaign: dto });
}
