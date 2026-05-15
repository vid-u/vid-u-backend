import { z } from "zod";

export const postPaymentMethodBodySchema = z
  .object({
    xenditChannelCode: z
      .string()
      .min(1)
      .max(40)
      .transform((s) => s.trim().toUpperCase()),
    label: z.string().min(1).max(120),
    bankName: z.string().min(1).max(120).optional(),
    accountNumber: z.string().min(4).max(80),
    accountName: z.string().min(1).max(200),
    isDefault: z.boolean().optional(),
  })
  .strict();

export type PostPaymentMethodBodyDto = z.infer<typeof postPaymentMethodBodySchema>;

export const patchPaymentMethodBodySchema = z
  .object({
    isDefault: z.boolean().optional(),
    label: z.string().min(1).max(120).optional(),
    bankName: z.union([z.string().min(1).max(120), z.null()]).optional(),
  })
  .strict()
  .refine(
    (o) => o.isDefault !== undefined || o.label !== undefined || o.bankName !== undefined,
    { message: "At least one of isDefault, label, bankName is required" },
  );

export type PatchPaymentMethodBodyDto = z.infer<typeof patchPaymentMethodBodySchema>;

export const paymentMethodIdParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export type PaymentMethodIdParamsDto = z.infer<typeof paymentMethodIdParamsSchema>;
