import { Prisma } from "../generated/prisma/client.js";
import { LedgerType, type Platform } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import { buildPaginationMeta } from "../utils/api-response.js";
import { grossFromFundedViews, creatorNetFromGross, toDecimal, netBudgetFromGross } from "../utils/money.js";
import { CREATOR_PAYOUT_SHARE } from "../config/fees.js";
import { channelLimits } from "../config/xendit_channel_limits.js";
import { maybeAutoPauseCampaign } from "./auto-pause.service.js";
import { pendingRefundNetFromAttempt } from "./brand-refund.service.js";
import { BRAND_REFUND_LEDGER_NOTE } from "./xendit-payout.service.js";
import {
  fetchCreatorContentStats,
  normalizeContentUrl,
} from "./platform-content.service.js";
import {
  getCachedSubmissionPreview,
  setCachedSubmissionPreview,
} from "./submission-preview-cache.service.js";
import type {
  ListBrandCampaignSubmissionsQueryDto,
  ListBrandRecentSubmissionsQueryDto,
  ListMeSubmissionsQueryDto,
  SubmissionPreviewBodyDto,
} from "../validation/submissions.schema.js";
import { contentUrlFromNormalized } from "./platform-content.service.js";

export async function requireCreatorDefaultPayoutMethod(creatorUserId: string) {
  const defaultPm = await prisma.paymentMethod.findFirst({
    where: { userId: creatorUserId, purpose: "creator_payout", isDefault: true },
  });
  if (!defaultPm) {
    throw new ForbiddenError("creator_default_payment_method_required");
  }
  return defaultPm;
}

export async function assertCampaignActiveForSubmission(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, status: "active" },
  });
  if (!campaign) throw new ConflictError("campaign_not_active");
}

export type SubmissionPreviewCachedPayload = {
  eligible: true;
  views: string;
  likes?: string;
  comments?: string;
  issues: string[];
  cached: boolean;
};

export async function runSubmissionPreview(
  creatorUserId: string,
  campaignId: string,
  body: SubmissionPreviewBodyDto,
): Promise<SubmissionPreviewCachedPayload> {
  await assertCampaignActiveForSubmission(campaignId);
  await requireCreatorDefaultPayoutMethod(creatorUserId);

  const cached = getCachedSubmissionPreview(creatorUserId, body.url, body.platform as Platform);
  if (cached) {
    return {
      eligible: true,
      views: cached.views,
      likes: cached.likes,
      comments: cached.comments,
      issues: [],
      cached: true,
    };
  }

  const stats = await fetchCreatorContentStats(
    body.url,
    body.platform as Platform,
    creatorUserId,
  );
  if (stats.views < 1000n) {
    throw new ValidationError("Views must exceed 1k threshold for MVP preview");
  }

  const payload = {
    views: stats.views.toString(),
    likes: stats.likes?.toString(),
    comments: stats.comments?.toString(),
  };
  setCachedSubmissionPreview(creatorUserId, body.url, body.platform as Platform, payload);

  return {
    eligible: true,
    ...payload,
    issues: [],
    cached: false,
  };
}

export async function confirmSubmission(
  creatorUserId: string,
  campaignId: string,
  body: SubmissionPreviewBodyDto,
) {
  const platform = body.platform as Platform;
  const normalizedUrl = normalizeContentUrl(body.url, platform);

  const defaultPm = await requireCreatorDefaultPayoutMethod(creatorUserId);
  const limits = channelLimits(defaultPm.xenditChannelCode);
  if (!limits) throw new ValidationError("Unsupported payout channel");

  const stats = await fetchCreatorContentStats(body.url, platform, creatorUserId);
  const viewsLocked = stats.views;
  let fundedViews = viewsLocked;
  let partialReason: "pool_exhausted" | "channel_max" | null = null;

  const submission = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      SELECT 1 FROM campaign WHERE id = ${campaignId}::uuid FOR UPDATE
    `);

    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, status: "active" },
    });
    if (!campaign) throw new ConflictError("campaign_not_active");

    const dup = await tx.submission.findFirst({
      where: {
        creatorUserId,
        normalizedUrl,
        NOT: { status: "rejected" },
      },
    });
    if (dup) throw new ConflictError("duplicate_submission");

    const agg = await tx.submission.aggregate({
      where: {
        campaignId,
        status: { in: ["pending", "paying", "payout_failed"] },
      },
      _sum: { grossAmount: true },
    });
    const reserved = agg._sum?.grossAmount ?? new Prisma.Decimal(0);
    const net = netBudgetFromGross(campaign.grossBudget);
    let pendingRefundNet = toDecimal(0);
    const pendingRefundAttempt = await tx.ledgerEntry.findFirst({
      where: {
        campaignId,
        ledgerType: LedgerType.release_attempt,
        note: `${BRAND_REFUND_LEDGER_NOTE}_pending`,
      },
      orderBy: { createdAt: "desc" },
    });
    if (pendingRefundAttempt?.xenditPayoutId) {
      const refundSettled = await tx.ledgerEntry.findFirst({
        where: {
          campaignId,
          xenditPayoutId: pendingRefundAttempt.xenditPayoutId,
          ledgerType: { in: [LedgerType.refund_available, LedgerType.release_failed] },
        },
      });
      if (!refundSettled) {
        pendingRefundNet = pendingRefundNetFromAttempt(pendingRefundAttempt);
      }
    }
    const available = net.sub(campaign.spentBudget).sub(reserved).sub(pendingRefundNet);
    const rate = campaign.ratePer1k;

    let gross = grossFromFundedViews(fundedViews, rate);
    if (gross.gt(available)) {
      const cpv = rate.div(toDecimal(1000));
      fundedViews =
        cpv.gt(0) && available.gt(0)
          ? BigInt(Math.max(0, Math.floor(Number(available.div(cpv).toString()))))
          : 0n;
      gross = grossFromFundedViews(fundedViews, rate);
      partialReason = "pool_exhausted";
    }

    let creatorNet = creatorNetFromGross(gross);
    const maxNet = toDecimal(limits.max);
    if (creatorNet.gt(maxNet)) {
      const maxGross = maxNet.div(toDecimal(CREATOR_PAYOUT_SHARE));
      const cpv = rate.div(toDecimal(1000));
      fundedViews = cpv.gt(0)
        ? BigInt(Math.max(0, Math.floor(Number(maxGross.div(cpv).toString()))))
        : 0n;
      gross = grossFromFundedViews(fundedViews, rate);
      creatorNet = creatorNetFromGross(gross);
      partialReason = "channel_max";
    }

    const minNet = toDecimal(limits.min);
    if (creatorNet.lt(minNet)) {
      throw new ConflictError("below_minimum_payout");
    }

    return tx.submission.create({
      data: {
        campaignId,
        creatorUserId,
        normalizedUrl,
        platform,
        viewsLocked,
        fundedViews,
        likesLocked: stats.likes ?? null,
        commentsLocked: stats.comments ?? null,
        grossAmount: gross,
        creatorNet,
        partialReason,
        status: "pending",
      },
    });
  });

  await maybeAutoPauseCampaign(campaignId);
  return submission;
}

const brandSubmissionListInclude = {
  campaign: { select: { id: true, title: true } },
  creator: { select: { id: true, name: true, avatarUrl: true } },
} as const;

function mapBrandSubmissionListItem(
  s: Prisma.SubmissionGetPayload<{ include: typeof brandSubmissionListInclude }>,
) {
  return {
    id: s.id,
    campaignId: s.campaignId,
    campaignTitle: s.campaign.title,
    creatorId: s.creatorUserId,
    creatorName: s.creator.name ?? "Creator",
    creatorAvatarUrl: s.creator.avatarUrl,
    normalizedUrl: s.normalizedUrl,
    postUrl: contentUrlFromNormalized(s.normalizedUrl, s.platform),
    platform: s.platform,
    viewsLocked: s.viewsLocked.toString(),
    fundedViews: s.fundedViews.toString(),
    grossAmount: s.grossAmount.toFixed(2),
    creatorNet: s.creatorNet.toFixed(2),
    partialReason: s.partialReason,
    status: s.status,
    submittedAt: s.submittedAt.toISOString(),
  };
}

export async function listBrandCampaignSubmissionsForUser(
  brandUserId: string,
  campaignId: string,
  q: ListBrandCampaignSubmissionsQueryDto,
) {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, brandUserId } });
  if (!c) throw new NotFoundError("Campaign not found");

  const where: Prisma.SubmissionWhereInput = { campaignId };
  if (q.status) where.status = q.status;

  const items = await prisma.submission.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    include: brandSubmissionListInclude,
  });
  return {
    items: items.map(mapBrandSubmissionListItem),
  };
}

/** Recent submissions for brand dashboard (all campaigns, paginated). */
export async function listBrandRecentSubmissionsForUser(
  brandUserId: string,
  q: ListBrandRecentSubmissionsQueryDto,
) {
  const page = q.page;
  const limit = q.limit;
  const skip = (page - 1) * limit;

  const where: Prisma.SubmissionWhereInput = {
    campaign: { brandUserId },
    ...(q.status
      ? { status: q.status }
      : { status: { in: ["pending", "rejected"] } }),
  };

  const [items, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip,
      take: limit,
      include: brandSubmissionListInclude,
    }),
    prisma.submission.count({ where }),
  ]);

  return {
    items: items.map(mapBrandSubmissionListItem),
    meta: buildPaginationMeta(page, limit, total),
  };
}

function meSubmissionsStatusWhere(
  status: ListMeSubmissionsQueryDto["status"],
): Prisma.SubmissionWhereInput["status"] | undefined {
  if (!status) return undefined;
  if (status === "pending") return { in: ["pending", "paying"] };
  if (status === "rejected") return { in: ["rejected", "payout_failed"] };
  return status;
}

const meSubmissionListInclude = {
  campaign: {
    select: {
      id: true,
      title: true,
      status: true,
      brand: {
        select: {
          brandProfile: { select: { brandName: true } },
        },
      },
    },
  },
} as const;

export async function listMeSubmissionsForUser(creatorUserId: string, q: ListMeSubmissionsQueryDto) {
  const where: Prisma.SubmissionWhereInput = { creatorUserId };
  if (q.scope === "recent") {
    where.status = { in: ["pending", "paying", "rejected", "payout_failed"] };
  } else {
    const statusFilter = meSubmissionsStatusWhere(q.status);
    if (statusFilter) where.status = statusFilter;
  }

  const page = q.page;
  const limit = q.limit;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip,
      take: limit,
      include: meSubmissionListInclude,
    }),
    prisma.submission.count({ where }),
  ]);

  return {
    items: items.map((s) => ({
      id: s.id,
      campaignId: s.campaignId,
      campaignTitle: s.campaign.title,
      campaignStatus: s.campaign.status,
      brandName: s.campaign.brand.brandProfile?.brandName ?? "Brand",
      normalizedUrl: s.normalizedUrl,
      postUrl: contentUrlFromNormalized(s.normalizedUrl, s.platform),
      platform: s.platform,
      viewsLocked: s.viewsLocked.toString(),
      fundedViews: s.fundedViews.toString(),
      payout: s.creatorNet.toFixed(2),
      partialReason: s.partialReason,
      status: s.status,
      rejectionReason: s.rejectionReason,
      submittedAt: s.submittedAt.toISOString(),
      paidAt: s.paidAt?.toISOString() ?? null,
    })),
    meta: buildPaginationMeta(page, limit, total),
  };
}
