import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { sendSuccess } from "../utils/api-response.js";

export const healthRouter = Router();

function sendLiveness(_req: Request, res: Response) {
  sendSuccess(
    res,
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    "Server is healthy",
  );
}

healthRouter.get(["/", "/health"], sendLiveness);

healthRouter.get("/health/ready", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    sendSuccess(res, { database: "up" }, "Ready");
  } catch (e) {
    next(e);
  }
});
