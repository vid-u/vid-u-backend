import { z } from "zod";

export const waitlistBody = z.object({
  email: z.string().email(),
  role: z.enum(["client", "tester"]),
  notes: z.string().max(2000).optional(),
});

export type WaitlistDto = z.infer<typeof waitlistBody>;
