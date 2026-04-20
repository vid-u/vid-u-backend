import type { Request, Response } from "express";
import { UserRole } from "../generated/prisma/enums.js";
import * as submissionService from "../services/submission.service.js";
import type {
  ListClientCampaignSubmissionsQueryDto,
  ListSubmissionsQueryDto,
  ListTesterSubmissionsQueryDto,
} from "../validation/submission.schema.js";
import { sendSuccess } from "../utils/api-response.js";

function submissionIdFromReq(req: Request): string {
  const p = req.params as { id?: string; submissionId?: string };
  const id = p.submissionId ?? p.id;
  if (!id) throw new Error("Missing submission id");
  return id;
}

/** Tester — `GET /submissions` (implicit `mine=true`). */
export async function listTesterSubmissions(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListTesterSubmissionsQueryDto;
  const { submissions, meta } = await submissionService.listSubmissions(
    { userId: req.dbUser!.id, role: req.dbUser!.role },
    { ...q, mine: "true" } as ListSubmissionsQueryDto,
  );
  sendSuccess(res, submissions, "ok", 200, meta);
}

/** Client — `GET /client/submissions` (optional `campaignId` filters to one campaign). */
export async function listClientCampaignSubmissions(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListClientCampaignSubmissionsQueryDto;
  const { campaignId, ...rest } = q;
  const { submissions, meta } = await submissionService.listSubmissions(
    { userId: req.dbUser!.id, role: req.dbUser!.role },
    { campaignId, ...rest } as ListSubmissionsQueryDto,
  );
  sendSuccess(res, submissions, "ok", 200, meta);
}

export async function postSubmission(req: Request, res: Response): Promise<void> {
  if (req.dbUser!.role !== UserRole.tester) {
    res.status(403).json({ success: false, message: "Testers only" });
    return;
  }
  const result = await submissionService.createSubmission(req.dbUser!.id, req.body);
  sendSuccess(res, result, "Submission created", 201);
}

/** Tester — `PATCH /submissions/:id/evidence` after presigned uploads. */
export async function patchTesterSubmissionEvidence(req: Request, res: Response): Promise<void> {
  if (req.dbUser!.role !== UserRole.tester) {
    res.status(403).json({ success: false, message: "Testers only" });
    return;
  }
  const { id } = req.params as { id: string };
  const result = await submissionService.patchSubmissionEvidenceUrls(req.dbUser!.id, id, req.body);
  sendSuccess(res, result, "Evidence attached", 200);
}

/** Tester — `GET /submissions/:id`. */
export async function getTesterSubmission(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const openAsClient = false;
  const result = await submissionService.getSubmissionForUser(
    id,
    { userId: req.dbUser!.id, role: req.dbUser!.role },
    { openAsClient },
  );
  sendSuccess(res, result, "ok");
}

/** Client — `GET /client/submissions/:submissionId`. */
export async function getClientCampaignSubmission(req: Request, res: Response): Promise<void> {
  const submissionId = submissionIdFromReq(req);
  const result = await submissionService.getSubmissionForUser(
    submissionId,
    { userId: req.dbUser!.id, role: req.dbUser!.role },
    { openAsClient: true },
  );
  sendSuccess(res, result, "ok");
}

export async function patchSubmission(req: Request, res: Response): Promise<void> {
  if (req.dbUser!.role !== UserRole.client) {
    res.status(403).json({ success: false, message: "Clients only" });
    return;
  }
  const submissionId = submissionIdFromReq(req);
  const row = await submissionService.patchSubmissionSeverity(
    submissionId,
    req.dbUser!.id,
    req.body.severity,
  );
  sendSuccess(res, row, "updated");
}

export async function postComment(req: Request, res: Response): Promise<void> {
  const submissionId = submissionIdFromReq(req);
  const comment = await submissionService.addComment(
    submissionId,
    req.dbUser!.id,
    req.body.body,
    req.body.parentId,
  );
  sendSuccess(res, { comment }, "Comment added", 201);
}

export async function postApprove(req: Request, res: Response): Promise<void> {
  if (req.dbUser!.role !== UserRole.client) {
    res.status(403).json({ success: false, message: "Clients only" });
    return;
  }
  const submissionId = submissionIdFromReq(req);
  const result = await submissionService.approveSubmission(
    submissionId,
    req.dbUser!.id,
    req.body,
  );
  sendSuccess(res, result, "Submission approved");
}

export async function postReject(req: Request, res: Response): Promise<void> {
  if (req.dbUser!.role !== UserRole.client) {
    res.status(403).json({ success: false, message: "Clients only" });
    return;
  }
  const submissionId = submissionIdFromReq(req);
  const result = await submissionService.rejectSubmission(
    submissionId,
    req.dbUser!.id,
    req.body,
  );
  sendSuccess(res, result, "Submission rejected");
}
