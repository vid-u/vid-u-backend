import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireViduCreator } from "../../middleware/role-access.js";
import * as oauth from "../../controllers/oauth.controller.js";

export const oauthRouter = Router();

oauthRouter.get("/tiktok/start", requireAuth, requireViduCreator, asyncHandler(oauth.getTikTokOAuthStart));
oauthRouter.get("/tiktok/callback", asyncHandler(oauth.getTikTokOAuthCallback));

oauthRouter.get(
  "/facebook/start",
  requireAuth,
  requireViduCreator,
  asyncHandler(oauth.getMetaOAuthStart),
);
oauthRouter.get("/facebook/callback", asyncHandler(oauth.getMetaOAuthCallback));
