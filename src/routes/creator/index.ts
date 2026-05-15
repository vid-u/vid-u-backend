import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireViduCreator } from "../../middleware/role-access.js";
import { creatorCampaignRouter } from "./campaign.routes.js";
import { creatorSubmissionsRouter } from "./submissions.routes.js";

/**
 * `/campaigns`: public discovery (`GET /`, `GET /:id`) + authenticated creator submissions.
 */
export const campaignsRouter = Router();
campaignsRouter.use(creatorCampaignRouter);
campaignsRouter.use(requireAuth, requireViduCreator, creatorSubmissionsRouter);
