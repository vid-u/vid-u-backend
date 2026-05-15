import { Router } from "express";

// --- Shared & public (route files live in `routes/` root) ---
import { waitlistRouter } from "./waitlist.routes.js";
import { authRouter } from "./auth.routes.js";
import { meRouter } from "./me.routes.js";
import { webhooksRouter } from "./webhooks.routes.js";
import { adminRouter } from "./admin.routes.js";

// --- Brand ---
import { brandsRouter } from "./brand/index.js";
import { uploadsRouter } from "./brand/uploads.routes.js";

// --- Creator ---
import { campaignsRouter } from "./creator/index.js";
import { oauthRouter } from "./creator/oauth.routes.js";

export const apiRouter = Router();

// --- Shared & public ---
apiRouter.use("/waitlist", waitlistRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/me", meRouter);
apiRouter.use("/webhooks", webhooksRouter);
apiRouter.use("/admin", adminRouter);

// --- Brand ---
apiRouter.use("/brands", brandsRouter);
apiRouter.use("/uploads", uploadsRouter);

// --- Creator ---
apiRouter.use("/campaigns", campaignsRouter);
apiRouter.use("/oauth", oauthRouter);
