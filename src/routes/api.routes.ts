import { Router } from "express";

import { waitlistRouter } from "./waitlist.routes.js";

export const apiRouter = Router();

apiRouter.use("/waitlist", waitlistRouter);
