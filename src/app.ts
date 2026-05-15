import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./lib/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { logger } from "./utils/logger.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { healthRouter } from "./routes/health.routes.js";
import { apiRouter } from "./routes/api.routes.js";

/**
 * Allow both apex and www variants for each configured HTTPS/HTTP origin so
 * marketing traffic at `www.` still passes CORS when only the naked domain is listed (or vice versa).
 */
function expandAllowedOrigins(configured: string[]): string[] {
  const out = new Set<string>();
  for (const o of configured) {
    out.add(o);
    try {
      const u = new URL(o);
      if (u.hostname === "localhost" || u.hostname.endsWith(".localhost")) {
        continue;
      }
      // Skip numeric IPs — www. expansion does not apply.
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)) {
        continue;
      }
      const port = u.port ? `:${u.port}` : "";
      if (u.hostname.startsWith("www.")) {
        out.add(`${u.protocol}//${u.hostname.slice(4)}${port}`);
      } else {
        out.add(`${u.protocol}//www.${u.hostname}${port}`);
      }
    } catch {
      /* malformed URL — keep literal entry only */
    }
  }
  return [...out];
}

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
        const configured = expandAllowedOrigins(
          (env.FRONTEND_URL ?? "http://localhost:5173")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        );
        if (configured.includes(origin)) {
          callback(null, true);
          return;
        }
        if (/^http:\/\/localhost:\d+$/.test(origin)) {
          callback(null, true);
          return;
        }
        logger.warn("CORS request denied — add origin to FRONTEND_URL", {
          origin,
          hint:
            "Use comma-separated origins; first entry is the OAuth redirect base (SPA). Include marketing + app, e.g. https://www.app.vid-u.com,https://www.vid-u.com",
        });
        callback(null, false);
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
