import { z } from "zod";
import { uuidString } from "./common.js";

/** Base58 Solana address (typical length 32–44). */
const solanaAddress = z
  .string()
  .trim()
  .min(32, "Invalid Solana address")
  .max(44, "Invalid Solana address")
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Invalid Solana address");

export const addPaymentMethodBody = z.object({
  walletAddress: solanaAddress,
  label: z.string().trim().max(120).optional(),
});

export type AddPaymentMethodDto = z.infer<typeof addPaymentMethodBody>;

export const paymentMethodIdParams = z.object({
  id: uuidString,
});
