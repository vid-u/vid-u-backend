import { z } from "zod";

export const syncBody = z.object({
  walletAddress: z.string().min(32).max(64),
  role: z.enum(["client", "tester"]).optional(),
});

export type SyncBodyDto = z.infer<typeof syncBody>;
