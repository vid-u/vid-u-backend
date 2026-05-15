import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { CampaignStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { MIN_PUBLISH_FLOOR_PHP, PLATFORM_DEPOSIT_FEE_PERCENT } from "../config/fees.js";
import { netBudgetFromGross, toDecimal } from "../utils/money.js";
import { maybeAutoPauseCampaign } from "./auto-pause.service.js";
import { publicUrlFromObjectKey } from "../lib/publicObjectUrl.js";
import { createXenditInvoice } from "./xendit-invoice.service.js";
import { processPayoutReleaseQueue } from "./payout-release.worker.js";
import type {
  BrandCheckoutSessionBodyDto,
  BrandRejectSubmissionBodyDto,
  CreateBrandCampaignBodyDto,
  PatchBrandCampaignBodyDto,
} from "../validation/brands-campaigns.schema.js";

function patchTouchesLockedCampaignDetails(patch: PatchBrandCampaignBodyDto): boolean {
  return (
    patch.title !== undefined ||
    patch.description !== undefined ||
    patch.platforms !== undefined ||
    patch.ratePer1k !== undefined ||
    patch.rules !== undefined ||
    patch.referenceLinks !== undefined ||
    patch.assetUrls !== undefined
  );
}

function decimalString(d: Prisma.Decimal): string {
  return d.toFixed(2);
}

export type BrandCampaignDto = Awaited<ReturnType<typeof computeCampaignDto>>;

async function computeCampaignDto(campaignId: string) {
  const c = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      submissions: {
        where: { status: { in: ["pending", "paying", "payout_failed"] } },
      },
      brand: {
        select: {
          brandProfile: { select: { brandName: true } },
        },
      },
    },
  });
  if (!c) return null;
  let reserved = new Prisma.Decimal(0);
  for (const s of c.submissions) {
    reserved = reserved.add(s.grossAmount);
  }
  const netBudget = netBudgetFromGross(c.grossBudget);
  const spent = c.spentBudget;
  const available = netBudget.sub(spent).sub(reserved);
  const brandName = c.brand.brandProfile?.brandName ?? "";
  return {
    id: c.id,
    brandUserId: c.brandUserId,
    brandName,
    title: c.title,
    description: c.description,
    ratePer1k: decimalString(c.ratePer1k),
    spentBudget: decimalString(spent),
    goalViews: c.goalViews.toString(),
    platforms: c.platforms,
    rules: c.rules,
    status: c.status,
    referenceLinks: c.referenceLinks,
    assetUrls: c.assetUrls,
    coverImageObjectKey: c.coverImageObjectKey,
    coverImageUrl: publicUrlFromObjectKey(c.coverImageObjectKey),
    netBudget: decimalString(netBudget),
    reservedBudget: decimalString(reserved),
    availableBudget: decimalString(available),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function mapBrandCampaignCard(c: {
  id: string;
  status: CampaignStatus;
  title: string;
  description: string;
  goalViews: bigint;
  platforms: unknown;
  coverImageObjectKey: string | null;
  updatedAt: Date;
  brand: { brandProfile: { brandName: string } | null };
  submissions: { fundedViews: bigint }[];
}) {
  let fundedTotal = 0n;
  for (const s of c.submissions) {
    fundedTotal += s.fundedViews;
  }
  return {
    id: c.id,
    status: c.status,
    brandName: c.brand.brandProfile?.brandName ?? "",
    title: c.title,
    description: c.description,
    coverImageObjectKey: c.coverImageObjectKey,
    coverImageUrl: publicUrlFromObjectKey(c.coverImageObjectKey),
    goalViews: c.goalViews.toString(),
    fundedViewsTotal: fundedTotal.toString(),
    platforms: c.platforms,
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listBrandCampaignCardsForUser(brandUserId: string) {
  const rows = await prisma.campaign.findMany({
    where: { brandUserId },
    orderBy: { updatedAt: "desc" },
    include: {
      submissions: {
        where: { NOT: { status: "rejected" } },
        select: { fundedViews: true },
      },
      brand: {
        select: {
          brandProfile: { select: { brandName: true } },
        },
      },
    },
  });
  return rows.map(mapBrandCampaignCard);
}

export async function createBrandCampaignForUser(
  brandUserId: string,
  b: CreateBrandCampaignBodyDto,
): Promise<NonNullable<BrandCampaignDto>> {
  const rate = toDecimal(b.ratePer1k);
  const netPool = new Prisma.Decimal(b.plannedGrossBudget).mul(
    toDecimal(1 - PLATFORM_DEPOSIT_FEE_PERCENT),
  );
  const cpv = rate.div(toDecimal(1000));
  const goalViewsNum =
    cpv.gt(0) && netPool.gt(0) ? Math.max(0, Math.floor(Number(netPool.div(cpv).toString()))) : 0;
  const goalViews = BigInt(goalViewsNum);
  const campaign = await prisma.campaign.create({
    data: {
      brandUserId,
      title: b.title.trim(),
      description: b.description.trim(),
      ratePer1k: rate,
      grossBudget: new Prisma.Decimal(0),
      spentBudget: new Prisma.Decimal(0),
      goalViews,
      platforms: b.platforms,
      rules: b.rules,
      status: "draft",
      referenceLinks: b.referenceLinks ?? undefined,
      assetUrls: b.assetUrls ?? undefined,
      coverImageObjectKey: b.coverImageObjectKey ?? undefined,
    },
  });
  const dto = await computeCampaignDto(campaign.id);
  if (!dto) throw new NotFoundError("Campaign not found");
  return dto;
}

export async function getBrandCampaignDtoForUser(
  brandUserId: string,
  id: string,
): Promise<NonNullable<BrandCampaignDto>> {
  const c = await prisma.campaign.findFirst({ where: { id, brandUserId } });
  if (!c) throw new NotFoundError("Campaign not found");
  const dto = await computeCampaignDto(id);
  if (!dto) throw new NotFoundError("Campaign not found");
  return dto;
}

export async function createBrandCheckoutSession(
  brandUserId: string,
  campaignId: string,
  parsed: BrandCheckoutSessionBodyDto,
) {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, brandUserId } });
  if (!c) throw new NotFoundError("Campaign not found");
  if (c.status === "ended") throw new ConflictError("Campaign ended");

  const gross = new Prisma.Decimal(parsed.grossAmount);
  const externalId = `fund_${randomUUID()}`;
  const { invoiceId, invoiceUrl } = await createXenditInvoice({
    externalId,
    amount: gross,
    description: `Campaign ${c.title}`,
    metadata: { campaignId, intent: parsed.intent ?? "add_funds" },
  });

  await prisma.fundingCheckoutSession.create({
    data: {
      campaignId,
      externalId,
      checkoutUrl: invoiceUrl,
      status: "pending",
      grossAmount: gross,
    },
  });

  return { checkoutUrl: invoiceUrl, sessionId: externalId, invoiceId };
}

export type PayoutReleaseResult =
  | { type: "nothing" }
  | { type: "ok"; count: number; ids: string[] };

export async function releasePayoutsForCampaign(
  brandUserId: string,
  campaignId: string,
): Promise<PayoutReleaseResult> {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, brandUserId } });
  if (!c) throw new NotFoundError("Campaign not found");
  if (c.status === "draft") {
    throw new ForbiddenError("Campaign not fundable for payout from draft");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT 1 FROM campaign WHERE id = ${campaignId}::uuid FOR UPDATE
    `);

    const locked = await tx.campaign.findFirstOrThrow({
      where: { id: campaignId },
      include: {
        submissions: {
          where: { status: { in: ["pending", "payout_failed"] } },
        },
      },
    });
    if (locked.submissions.length === 0) {
      return { type: "nothing" as const };
    }
    const netBudget = netBudgetFromGross(locked.grossBudget);
    const reservedAgg = await tx.submission.aggregate({
      where: {
        campaignId,
        status: { in: ["pending", "paying", "payout_failed"] },
      },
      _sum: { grossAmount: true },
    });
    const reserved = reservedAgg._sum?.grossAmount ?? new Prisma.Decimal(0);
    if (reserved.gt(netBudget.sub(locked.spentBudget))) {
      throw new ConflictError("insufficient_pool");
    }
    const now = new Date();
    for (const s of locked.submissions) {
      await tx.submission.update({
        where: { id: s.id },
        data: { status: "paying", lastPayoutAttemptAt: now },
      });
    }
    return { type: "ok" as const, count: locked.submissions.length, ids: locked.submissions.map((s) => s.id) };
  });

  return result;
}

export function startPayoutReleaseWorker(ids: string[]): void {
  void processPayoutReleaseQueue(ids);
}

export async function rejectBrandSubmission(
  brandUserId: string,
  campaignId: string,
  submissionId: string,
  body: BrandRejectSubmissionBodyDto,
): Promise<void> {
  const s = await prisma.submission.findFirst({
    where: { id: submissionId, campaignId, campaign: { brandUserId } },
  });
  if (!s) throw new NotFoundError("Submission not found");
  if (s.status === "paid") throw new ConflictError("Cannot reject paid submission");
  if (s.status === "paying") throw new ConflictError("already_paying");

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: s.id },
      data: { status: "rejected", rejectionReason: body.reason },
    });
  });
  await maybeAutoPauseCampaign(s.campaignId);
}

export async function refundAvailableCampaignBalance(
  brandUserId: string,
  campaignId: string,
): Promise<{ refunded: string }> {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, brandUserId } });
  if (!c) throw new NotFoundError("Campaign not found");
  const dto = await computeCampaignDto(campaignId);
  if (!dto) throw new NotFoundError("Campaign not found");
  const available = new Prisma.Decimal(dto.availableBudget);
  if (available.lte(0)) throw new ConflictError("No available balance");

  const idem = `refund:${campaignId}:${Date.now()}`;
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: {
        campaignId,
        ledgerType: "refund_available",
        amountGross: available,
        idempotencyKey: idem,
        note: "brand_refund_available",
      },
    });
    await tx.campaign.update({
      where: { id: campaignId },
      data: { grossBudget: { decrement: available } },
    });
  });
  await maybeAutoPauseCampaign(campaignId);

  return { refunded: decimalString(available) };
}

export async function patchBrandCampaignForUser(
  brandUserId: string,
  id: string,
  patch: PatchBrandCampaignBodyDto,
): Promise<NonNullable<BrandCampaignDto>> {
  const c = await prisma.campaign.findFirst({ where: { id, brandUserId } });
  if (!c) throw new NotFoundError("Campaign not found");

  if (patchTouchesLockedCampaignDetails(patch)) {
    const allowed =
      c.status === "draft" ||
      (await prisma.submission.count({ where: { campaignId: id } })) === 0;
    if (!allowed) throw new ConflictError("campaign_details_locked");
  }

  if (patch.status === "active") {
    const dto = await computeCampaignDto(id);
    if (dto && new Prisma.Decimal(dto.availableBudget).lt(toDecimal(MIN_PUBLISH_FLOOR_PHP))) {
      throw new ConflictError("below_publish_floor");
    }
  }

  const nextRate =
    patch.ratePer1k !== undefined ? toDecimal(patch.ratePer1k) : toDecimal(c.ratePer1k);
  let nextGoalViews: bigint | undefined;
  if (patch.ratePer1k !== undefined) {
    const netPool = netBudgetFromGross(c.grossBudget);
    const cpv = nextRate.div(toDecimal(1000));
    const goalViewsNum =
      cpv.gt(0) && netPool.gt(0) ? Math.max(0, Math.floor(Number(netPool.div(cpv).toString()))) : 0;
    nextGoalViews = BigInt(goalViewsNum);
  }

  await prisma.campaign.update({
    where: { id },
    data: {
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.status ? { status: patch.status as CampaignStatus } : {}),
      ...(patch.platforms ? { platforms: patch.platforms } : {}),
      ...(patch.ratePer1k !== undefined ? { ratePer1k: nextRate } : {}),
      ...(nextGoalViews !== undefined ? { goalViews: nextGoalViews } : {}),
      ...(patch.rules ? { rules: patch.rules } : {}),
      ...(patch.referenceLinks !== undefined
        ? {
            referenceLinks:
              patch.referenceLinks === null ? Prisma.JsonNull : patch.referenceLinks,
          }
        : {}),
      ...(patch.assetUrls !== undefined
        ? { assetUrls: patch.assetUrls === null ? Prisma.JsonNull : patch.assetUrls }
        : {}),
      ...(patch.coverImageObjectKey !== undefined
        ? { coverImageObjectKey: patch.coverImageObjectKey }
        : {}),
    },
  });
  const dto = await computeCampaignDto(id);
  if (!dto) throw new NotFoundError("Campaign not found");
  return dto;
}
