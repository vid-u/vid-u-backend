import { Router } from "express";

// Shared & public routes
import { authRouter } from "./auth.routes.js";
import { jobsRouter } from "./jobs.routes.js";
import { uploadRouter } from "./uploads.routes.js";
import { waitlistRouter } from "./waitlist.routes.js";

// Tester routes
import { testerAvailabilityRouter } from "./tester/availability.routes.js";
import { campaignsRouter } from "./tester/campaigns.routes.js";
import { testerDashboardRouter } from "./tester/dashboard.routes.js";
import { paymentMethodsRouter } from "./tester/payment-methods.routes.js";
import { testerProfileRouter } from "./tester/profile.routes.js";
import { testerSubmissionsRouter } from "./tester/submissions.routes.js";
import { testerWorkPreferencesRouter } from "./tester/work-preferences.routes.js";

// Client routes
import { clientCampaignRouter } from "./client/campaigns.routes.js";
import { clientDashboardRouter } from "./client/dashboard.routes.js";
import { clientPaymentMethodsRouter } from "./client/payment-methods.routes.js";
import { clientProfileRouter } from "./client/profile.routes.js";
import { clientSubmissionsRouter } from "./client/submissions.routes.js";

export const apiRouter = Router();
const clientRouter = Router();

// --- Shared & public ---
apiRouter.use("/auth", authRouter);
apiRouter.use("/uploads", uploadRouter);
apiRouter.use("/waitlist", waitlistRouter);
apiRouter.use("/jobs", jobsRouter);

// --- Tester ---
apiRouter.use("/payment-methods", paymentMethodsRouter);
apiRouter.use("/campaigns", campaignsRouter);
apiRouter.use("/submissions", testerSubmissionsRouter);
apiRouter.use("/dashboard", testerDashboardRouter);
apiRouter.use("/profile", testerProfileRouter);
apiRouter.use("/work-preferences", testerWorkPreferencesRouter);
apiRouter.use("/availability", testerAvailabilityRouter);

// --- Client ---
apiRouter.use("/client", clientRouter);
clientRouter.use("/dashboard", clientDashboardRouter);
clientRouter.use("/profile", clientProfileRouter);
clientRouter.use("/payment-methods", clientPaymentMethodsRouter);
clientRouter.use("/campaigns", clientCampaignRouter);
clientRouter.use("/submissions", clientSubmissionsRouter);
