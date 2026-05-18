import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { CampaignStatus } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { MIN_PUBLISH_SPENDABLE_FLOOR_PHP } from "../config/fees.js";
import { computeCampaignBalances } from "./budget.service.js";
import {
  getPendingBrandRefundNet,
  hasInFlightBrandRefund,
  refundAvailableCampaignBalance as executeBrandRefund,
} from "./brand-refund.service.js";
import { netBudgetFromGross, toDecimal } from "../utils/money.js";
import { maybeAutoPauseCampaign } from "./auto-pause.service.js";
import { publicUrlFromObjectKey, resolveObjectDisplayUrl } from "../lib/publicObjectUrl.js";
import { brandCampaignFundingRedirectUrl } from "../lib/frontendOrigin.js";
import { createXenditInvoice } from "./xendit-invoice.service.js";
import { reconcileMissedInitialXenditSetup } from "./xendit-platform.service.js";
import {
  assertCampaignXenditPoolSettled,
  isCampaignXenditPoolSettled,
  prepareBrandXenditForFunding,
  reconcileLegacyFundingPendingCampaign,
} from "./xendit-split.service.js";
import { isXenPlatformEnabled, ensureBrandXenditSubAccount } from "./xendit-platform.service.js";
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
  await reconcileLegacyFundingPendingCampaign(campaignId);

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
  const pendingRefundNet = await getPendingBrandRefundNet(campaignId);
  const balances = computeCampaignBalances(c, c.submissions, pendingRefundNet);
  const brandName = c.brand.brandProfile?.brandName ?? "";
  const refundInProgress = pendingRefundNet.gt(0) || (await hasInFlightBrandRefund(campaignId));
  const xenditPoolSettled = await isCampaignXenditPoolSettled(campaignId);
  return {
    id: c.id,
    brandUserId: c.brandUserId,
    brandName,
    title: c.title,
    description: c.description,
    ratePer1k: decimalString(c.ratePer1k),
    grossBudget: balances.grossBudget,
    spentBudget: balances.spentBudget,
    plannedGrossBudget: decimalString(c.plannedGrossBudget),
    goalViews: c.goalViews.toString(),
    platforms: c.platforms,
    rules: c.rules,
    status: c.status,
    referenceLinks: c.referenceLinks,
    assetUrls: c.assetUrls,
    coverImageObjectKey: c.coverImageObjectKey,
    coverImageUrl: await resolveObjectDisplayUrl(c.coverImageObjectKey),
    netBudget: balances.netBudget,
    reservedBudget: balances.reservedBudget,
    payoutPoolBudget: balances.payoutPoolBudget,
    pendingRefundBudget: balances.pendingRefundBudget,
    availableBudget: balances.availableBudget,
    refundInProgress,
    xenditPoolSettled,
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
  const cards = rows.map(mapBrandCampaignCard);
  return Promise.all(
    cards.map(async (card) => {
      if (card.coverImageUrl || !card.coverImageObjectKey) return card;
      return {
        ...card,
        coverImageUrl: await resolveObjectDisplayUrl(card.coverImageObjectKey),
      };
    }),
  );
}

export async function createBrandCampaignForUser(
  brandUserId: string,
  b: CreateBrandCampaignBodyDto,
): Promise<NonNullable<BrandCampaignDto>> {
  const rate = toDecimal(b.ratePer1k);
  const plannedGross = toDecimal(b.plannedGrossBudget);
  const campaign = await prisma.campaign.create({
    data: {
      brandUserId,
      title: b.title.trim(),
      description: b.description.trim(),
      ratePer1k: rate,
      grossBudget: new Prisma.Decimal(0),
      spentBudget: new Prisma.Decimal(0),
      plannedGrossBudget: plannedGross,
      goalViews: 0n,
      platforms: b.platforms,
      rules: b.rules,
      status: "draft",
      referenceLinks: b.referenceLinks ?? undefined,
      assetUrls: b.assetUrls ?? undefined,
      coverImageObjectKey: b.coverImageObjectKey ?? undefined,
    },
  });
  if (isXenPlatformEnabled()) {
    await ensureBrandXenditSubAccount(brandUserId);
  }

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

  /** After the campaign has any funded pool, further checkouts are always top-ups. */
  const hasInitialFund = toDecimal(c.grossBudget).gt(0);
  const intent = hasInitialFund ? "add_funds" : (parsed.intent ?? "add_funds");

  await reconcileMissedInitialXenditSetup(brandUserId);

  const externalId = `fund_${randomUUID()}`;
  const xenditSetup = await prepareBrandXenditForFunding(brandUserId);

  const { invoiceId, invoiceUrl } = await createXenditInvoice({
    externalId,
    amount: gross,
    description: `Campaign ${c.title}`,
    metadata: { campaignId, intent, brandUserId },
    successRedirectUrl: brandCampaignFundingRedirectUrl(campaignId, "success"),
    failureRedirectUrl: brandCampaignFundingRedirectUrl(campaignId, "failed"),
    forUserId: null,
    splitRuleId: xenditSetup?.splitRuleId ?? null,
  });

  await prisma.fundingCheckoutSession.create({
    data: {
      campaignId,
      externalId,
      xenditInvoiceId: invoiceId,
      xenditSubAccountId: xenditSetup?.subAccountId ?? null,
      xenditSplitRuleId: xenditSetup?.splitRuleId ?? null,
      intent,
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

  await assertCampaignXenditPoolSettled(campaignId);

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

export async function restoreBrandSubmission(
  brandUserId: string,
  campaignId: string,
  submissionId: string,
): Promise<void> {
  const s = await prisma.submission.findFirst({
    where: { id: submissionId, campaignId, campaign: { brandUserId } },
  });
  if (!s) throw new NotFoundError("Submission not found");
  if (s.status !== "rejected") throw new ConflictError("submission_not_rejected");

  const dup = await prisma.submission.findFirst({
    where: {
      creatorUserId: s.creatorUserId,
      normalizedUrl: s.normalizedUrl,
      id: { not: s.id },
      NOT: { status: "rejected" },
    },
  });
  if (dup) throw new ConflictError("duplicate_submission");

  await prisma.submission.update({
    where: { id: s.id },
    data: { status: "pending", rejectionReason: null },
  });
  await maybeAutoPauseCampaign(s.campaignId);
}

export async function refundAvailableCampaignBalance(
  brandUserId: string,
  campaignId: string,
): Promise<{ refunded: string; payoutId?: string }> {
  return executeBrandRefund(brandUserId, campaignId);
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
    if (dto && new Prisma.Decimal(dto.availableBudget).lt(toDecimal(MIN_PUBLISH_SPENDABLE_FLOOR_PHP))) {
      throw new ConflictError("below_publish_floor");
    }
  }

  const nextRate =
    patch.ratePer1k !== undefined ? toDecimal(patch.ratePer1k) : toDecimal(c.ratePer1k);
  const isFunded = toDecimal(c.grossBudget).gt(0);
  let nextGoalViews: bigint | undefined;
  if (patch.ratePer1k !== undefined && isFunded) {
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
      ...(patch.plannedGrossBudget !== undefined
        ? { plannedGrossBudget: toDecimal(patch.plannedGrossBudget) }
        : {}),
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
