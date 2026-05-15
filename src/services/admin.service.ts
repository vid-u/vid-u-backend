import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import { recomputeCampaignCachesFromLedger } from "./ledger.service.js";
import type { AdminLedgerAdjustBodyDto } from "../validation/admin.schema.js";

export async function reconcileCampaignBudgets(campaignId: string) {
  const { grossBudget, spentBudget } = await recomputeCampaignCachesFromLedger(campaignId);
  return { grossBudget: grossBudget.toFixed(2), spentBudget: spentBudget.toFixed(2) };
}

export async function adminLedgerAdjust(campaignId: string, body: AdminLedgerAdjustBodyDto) {
  const amount = new Prisma.Decimal(body.amountGross);
  const existing = await prisma.ledgerEntry.findFirst({
    where: { idempotencyKey: body.idempotencyKey },
  });
  if (existing) {
    return { duplicate: true as const };
  }
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: {
        campaignId,
        ledgerType: "adjustment",
        amountGross: amount,
        idempotencyKey: body.idempotencyKey,
        note: body.note,
      },
    });
    await tx.campaign.update({
      where: { id: campaignId },
      data: { grossBudget: { increment: amount } },
    });
  });
  return { duplicate: false as const, ok: true as const };
}

export async function adminForceRejectSubmission(submissionId: string) {
  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "rejected", rejectionReason: "admin_force" },
  });
}

export async function adminAuditCampaign(campaignId: string) {
  const c = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!c) throw new NotFoundError();
  const ledger = await prisma.ledgerEntry.findMany({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
  });
  const submissions = await prisma.submission.findMany({ where: { campaignId } });
  return { campaign: c, ledger, submissions };
}
