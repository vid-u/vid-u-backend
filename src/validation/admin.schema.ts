import { z } from "zod";

export const adminCampaignIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export type AdminCampaignIdParamsDto = z.infer<typeof adminCampaignIdParamsSchema>;

export const adminSubmissionIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export type AdminSubmissionIdParamsDto = z.infer<typeof adminSubmissionIdParamsSchema>;

export const adminLedgerAdjustBodySchema = z
  .object({
    amountGross: z.string().min(1),
    note: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

export type AdminLedgerAdjustBodyDto = z.infer<typeof adminLedgerAdjustBodySchema>;
