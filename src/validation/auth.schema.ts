import { z } from "zod";

export const emailSendCodeBodySchema = z.object({
  email: z.string().email(),
});

export const emailVerifyBodySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});
