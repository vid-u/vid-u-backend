import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./lib/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { healthRouter } from "./routes/health.routes.js";
import { apiRouter } from "./routes/api.routes.js";

export function createApp(): express.Application {
  const app = express();
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const configured = (env.FRONTEND_URL ?? "http://localhost:5173")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        if (configured.includes(origin)) {
          callback(null, true);
          return;
        }
        if (/^http:\/\/localhost:\d+$/.test(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(requestLogger);

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === "/" ||
      req.path === "/health" ||
      req.path.startsWith("/health/"),
  });

  app.use(healthRouter);
  app.use(apiLimiter);
  app.use(apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
