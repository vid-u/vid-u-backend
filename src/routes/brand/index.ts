import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireViduBrand } from "../../middleware/role-access.js";
import { brandCampaignRouter } from "./campaign.routes.js";
import { brandSubmissionsRouter } from "./submissions.routes.js";

/**
 * All `/brands/...` routes. Composed from feature routers (`campaign`, `submissions`, etc.).
 */
export const brandsRouter = Router();
brandsRouter.use(requireAuth, requireViduBrand);
brandsRouter.use(brandCampaignRouter);
brandsRouter.use(brandSubmissionsRouter);
