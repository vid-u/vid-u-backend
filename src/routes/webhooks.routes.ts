import express, { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as wh from "../controllers/webhooks.xendit.controller.js";

export const webhooksRouter = Router();

webhooksRouter.post("/xendit", express.json(), asyncHandler(wh.postXenditWebhook));
