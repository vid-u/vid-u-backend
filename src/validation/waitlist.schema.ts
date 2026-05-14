import { z } from "zod";

export const waitlistBody = z
  .object({
    email: z.string().email(),
    role: z.enum(["brand", "creator"]),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type WaitlistDto = z.infer<typeof waitlistBody>;
