import type { Request, Response } from "express";
import { paramString } from "../lib/params.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  ListBrandCampaignSubmissionsQueryDto,
  ListBrandRecentSubmissionsQueryDto,
  ListMeSubmissionsQueryDto,
  SubmissionPreviewBodyDto,
} from "../validation/submissions.schema.js";
import * as submissions from "../services/submissions.service.js";

export async function postSubmissionPreview(req: Request, res: Response): Promise<void> {
  const payload = await submissions.runSubmissionPreview(
    req.dbUser!.id,
    paramString(req.params.id),
    req.body as SubmissionPreviewBodyDto,
  );
  sendSuccess(res, payload);
}

export async function postSubmissionConfirm(req: Request, res: Response): Promise<void> {
  const submission = await submissions.confirmSubmission(
    req.dbUser!.id,
    paramString(req.params.id),
    req.body as SubmissionPreviewBodyDto,
  );
  sendSuccess(res, { submission: { id: submission.id, status: submission.status } }, "ok", 201);
}

export async function listCampaignSubmissions(req: Request, res: Response): Promise<void> {
  const data = await submissions.listBrandCampaignSubmissionsForUser(
    req.dbUser!.id,
    paramString(req.params.id),
    req.query as ListBrandCampaignSubmissionsQueryDto,
  );
  sendSuccess(res, data);
}

export async function listBrandRecentSubmissions(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListBrandRecentSubmissionsQueryDto;
  const { items, meta } = await submissions.listBrandRecentSubmissionsForUser(req.dbUser!.id, q);
  sendSuccess(res, { items }, "ok", 200, meta);
}

export async function listMeSubmissions(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListMeSubmissionsQueryDto;
  const { items, meta } = await submissions.listMeSubmissionsForUser(req.dbUser!.id, q);
  sendSuccess(res, { items }, "ok", 200, meta);
}
