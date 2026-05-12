import winston from "winston";
import { env } from "../lib/env.js";

export const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
      const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      return `${String(timestamp)} [${level}] ${stack ?? message}${rest}`;
    })
  ),
  defaultMeta: { service: "vidu-landing-page-backend" },
  transports: [new winston.transports.Console()],
});
