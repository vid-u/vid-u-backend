import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/** Per-user cap on `POST /campaigns/:id/submissions/preview` (rolling window). */
export const submissionPreviewRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = req.dbUser?.id;
    if (id) return `preview:${id}`;
    return `preview:${ipKeyGenerator(req.ip ?? "unknown")}`;
  },
});
