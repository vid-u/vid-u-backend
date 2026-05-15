import rateLimit from "express-rate-limit";

/** Per-user cap on `POST /campaigns/:id/submissions/preview` (rolling window). */
export const submissionPreviewRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = req.dbUser?.id;
    return id ? `preview:${id}` : `preview:${req.ip ?? "unknown"}`;
  },
});
