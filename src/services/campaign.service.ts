import {
  CampaignStatus,
  PayoutStatus,
  SubmissionStatus,
  UserRole,
} from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  serializeCampaignListPreview,
  serializeClientCampaignListPreview,
  serializeCampaignUi,
} from "../lib/campaign-ui.js";
import {
  BUGHYVE_STANDARD_DISCLOSURE_GUIDELINES,
  BUGHYVE_STANDARD_REWARD_ELIGIBILITY,
} from "../lib/bughyve-campaign-standards.js";
import { stubEscrowPda, stubTxSignature } from "../lib/stubChain.js";
import { dec, prisma } from "../lib/prisma.js";
import { buildPaginationMeta, pageToOffset } from "../utils/api-response.js";
import type {
  CreateCampaignDto,
  FundCampaignDto,
  ListPublicCampaignsQueryDto,
  PatchCampaignDto,
  TopUpCampaignDto,
} from "../validation/campaign.schema.js";
import type { ListCampaignsOptions } from "../types/campaign.types.js";
import type { ViewerContext } from "../types/viewer.types.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";

const campaignInclude = {
  client: { include: { clientProfile: true } },
  _count: { select: { submissions: true } },
} as const;

type CampaignUiRow = Prisma.CampaignGetPayload<{
  include: typeof campaignInclude;
}>;

/** Distinct `testerId` count per campaign (for `uniqueTestersCount`). */
async function uniqueTesterCountsByCampaignIds(
  campaignIds: string[],
): Promise<Map<string, number>> {
  if (campaignIds.length === 0) return new Map();
  const pairs = await prisma.submission.findMany({
    where: { campaignId: { in: campaignIds } },
    distinct: ["campaignId", "testerId"],
    select: { campaignId: true, testerId: true },
  });
  const m = new Map<string, number>();
  for (const p of pairs) {
    m.set(p.campaignId, (m.get(p.campaignId) ?? 0) + 1);
  }
  return m;
}

async function previewStatsForCampaignIds(campaignIds: string[]) {
  if (campaignIds.length === 0) {
    return {
      submissionTotals: new Map<string, number>(),
      paidByCampaign: new Map<string, number>(),
      paidToTestersByCampaign: new Map<string, number>(),
    };
  }

  const [submissionTotals, paidAgg, testerShareAgg] = await Promise.all([
    prisma.submission.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
    prisma.submission.groupBy({
      by: ["campaignId"],
      where: {
        campaignId: { in: campaignIds },
        status: SubmissionStatus.approved,
      },
      _sum: { payoutAmount: true },
    }),
    prisma.payout.groupBy({
      by: ["campaignId"],
      where: {
        campaignId: { in: campaignIds },
        status: PayoutStatus.completed,
      },
      _sum: { testerAmount: true },
    }),
  ]);

  return {
    submissionTotals: new Map(
      submissionTotals.map((r) => [r.campaignId, r._count._all]),
    ),
    paidByCampaign: new Map(
      paidAgg.map((r) => [
        r.campaignId,
        r._sum.payoutAmount ? Number(dec(r._sum.payoutAmount)) : 0,
      ]),
    ),
    paidToTestersByCampaign: new Map(
      testerShareAgg.map((r) => [
        r.campaignId,
        r._sum.testerAmount ? Number(dec(r._sum.testerAmount)) : 0,
      ]),
    ),
  };
}

function rowToUi(
  row: CampaignUiRow,
  uniqueTestersCount: number,
  paidByCampaign: Map<string, number>,
  paidToTestersByCampaign: Map<string, number>,
) {
  const companyName = row.client?.clientProfile?.companyName ?? "Unknown";
  const logoUrl = row.client?.clientProfile?.logoUrl ?? null;
  return serializeCampaignUi(row, {
    companyName,
    logoUrl,
    submissionsCount: row._count.submissions,
    uniqueTestersCount,
    totalPaid: paidByCampaign.get(row.id) ?? 0,
    totalPaidToTesters: paidToTestersByCampaign.get(row.id) ?? 0,
  });
}

function toDecimal(v: number | string): Prisma.Decimal {
  return new Prisma.Decimal(typeof v === "number" ? String(v) : v);
}

function parseOptionalDate(s: string | undefined): Date | undefined {
  if (!s?.trim()) return undefined;
  return new Date(`${s.trim()}T12:00:00.000Z`);
}

async function loadCampaignUi(id: string) {
  const row = await prisma.campaign.findUnique({
    where: { id },
    include: campaignInclude,
  });
  if (!row) throw new NotFoundError("Campaign not found");
  const [counts, paidMaps] = await Promise.all([
    uniqueTesterCountsByCampaignIds([id]),
    previewStatsForCampaignIds([id]),
  ]);
  return rowToUi(
    row,
    counts.get(id) ?? 0,
    paidMaps.paidByCampaign,
    paidMaps.paidToTestersByCampaign,
  );
}

export async function createDraftCampaign(
  clientId: string,
  data: CreateCampaignDto,
) {
  const campaign = await prisma.campaign.create({
    data: {
      clientId,
      title: data.title,
      description: data.description,
      scope: data.scope,
      outOfScope: data.outOfScope,
      inScopeTestCaseUrl: data.inScopeTestCaseUrl,
      disclosureGuidelines: BUGHYVE_STANDARD_DISCLOSURE_GUIDELINES,
      rewardEligibility: BUGHYVE_STANDARD_REWARD_ELIGIBILITY,
      downloadLinks: data.downloadLinks as Prisma.InputJsonValue,
      startDate: parseOptionalDate(data.startDate),
      endDate: parseOptionalDate(data.endDate),
      isApproved: data.isApproved ?? false,
      deviceRequirements: data.deviceRequirements,
      visibility: data.visibility,
      reviewWindowDays: data.reviewWindowDays,
      severityRewards: data.severityRewards as Prisma.InputJsonValue,
      listed: false,
      status: CampaignStatus.draft,
    },
  });
  return loadCampaignUi(campaign.id);
}

const publicListInclude = {
  client: { include: { clientProfile: true } },
} as const;

/** Public browse — card previews + pagination (not full `serializeCampaignUi`). */
export async function listPublicCampaigns(query: ListPublicCampaignsQueryDto) {
  const { page, limit, status, devices, q, sort } = query;
  const offset = pageToOffset(page, limit);

  const statusFilter: Prisma.EnumCampaignStatusFilter | CampaignStatus =
    status === "all"
      ? {
          in: [
            CampaignStatus.active,
            CampaignStatus.paused,
            CampaignStatus.ended,
          ],
        }
      : status === "active"
        ? CampaignStatus.active
        : status === "paused"
          ? CampaignStatus.paused
          : CampaignStatus.ended;

  const where: Prisma.CampaignWhereInput = {
    listed: true,
    escrowPda: { not: null },
    status: statusFilter,
    ...(devices.length > 0 ? { deviceRequirements: { hasSome: devices } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            {
              client: {
                clientProfile: {
                  companyName: { contains: q, mode: "insensitive" },
                },
              },
            },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.CampaignOrderByWithRelationInput =
    sort === "most_pay" ? { budget: "desc" } : { createdAt: "desc" };

  const [total, rows] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
      include: publicListInclude,
    }),
  ]);

  const ids = rows.map((r) => r.id);
  const [{ submissionTotals, paidByCampaign, paidToTestersByCampaign }, testerCounts] =
    await Promise.all([
      previewStatsForCampaignIds(ids),
      uniqueTesterCountsByCampaignIds(ids),
    ]);

  const campaigns = rows.map((row) => {
    const companyName = row.client?.clientProfile?.companyName ?? "Unknown";
    const logoUrl = row.client?.clientProfile?.logoUrl;
    return serializeCampaignListPreview(row, {
      companyName,
      logoUrl,
      testers: testerCounts.get(row.id) ?? 0,
      submissions: submissionTotals.get(row.id) ?? 0,
      totalPaid: paidByCampaign.get(row.id) ?? 0,
      totalPaidToTesters: paidToTestersByCampaign.get(row.id) ?? 0,
    });
  });

  return {
    campaigns,
    meta: buildPaginationMeta(page, limit, total),
  };
}

/** Client’s campaigns — list card previews (same narrow shape as public `/campaigns`, plus `listed` / `escrowPda`; `stats.totalBudget` = funded USDC). */
export async function listCampaigns(opts: ListCampaignsOptions) {
  if (!opts.mine) {
    throw new ForbiddenError("Use listPublicCampaigns for public browse");
  }
  if (!opts.authUserId || opts.authRole !== UserRole.client) {
    throw new ForbiddenError("mine=true requires authenticated client");
  }
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 10;
  const offset = pageToOffset(page, limit);
  const where = { clientId: opts.authUserId };

  const [total, rows] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limit,
      include: publicListInclude,
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const [{ submissionTotals }, testerCounts] = await Promise.all([
    previewStatsForCampaignIds(ids),
    uniqueTesterCountsByCampaignIds(ids),
  ]);

  const campaigns = rows.map((row) => {
    const companyName = row.client?.clientProfile?.companyName ?? "Unknown";
    const logoUrl = row.client?.clientProfile?.logoUrl;
    return serializeClientCampaignListPreview(row, {
      companyName,
      logoUrl,
      testers: testerCounts.get(row.id) ?? 0,
      submissions: submissionTotals.get(row.id) ?? 0,
      totalBudget: Number(dec(row.budget) ?? "0"),
    });
  });
  return {
    campaigns,
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function getCampaignForViewer(
  campaignId: string,
  viewer: ViewerContext,
) {
  const c = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: campaignInclude,
  });
  if (!c) throw new NotFoundError("Campaign not found");

  const [counts, paidMaps] = await Promise.all([
    uniqueTesterCountsByCampaignIds([c.id]),
    previewStatsForCampaignIds([c.id]),
  ]);
  const uniqueTestersCount = counts.get(c.id) ?? 0;

  if (c.clientId === viewer.userId) {
    return rowToUi(
      c,
      uniqueTestersCount,
      paidMaps.paidByCampaign,
      paidMaps.paidToTestersByCampaign,
    );
  }

  if (viewer.role === UserRole.tester) {
    const ok =
      c.listed &&
      c.escrowPda != null &&
      (c.status === CampaignStatus.active ||
        c.status === CampaignStatus.paused);
    if (!ok) throw new ForbiddenError("Campaign is not visible to testers");
    return rowToUi(
      c,
      uniqueTestersCount,
      paidMaps.paidByCampaign,
      paidMaps.paidToTestersByCampaign,
    );
  }

  throw new ForbiddenError("Cannot access this campaign");
}

export async function getCampaignPublicBrowse(campaignId: string) {
  const c = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      listed: true,
      escrowPda: { not: null },
      status: { in: [CampaignStatus.active, CampaignStatus.paused] },
    },
    include: campaignInclude,
  });
  if (!c) throw new NotFoundError("Campaign not found");
  const [counts, paidMaps] = await Promise.all([
    uniqueTesterCountsByCampaignIds([c.id]),
    previewStatsForCampaignIds([c.id]),
  ]);
  return rowToUi(
    c,
    counts.get(c.id) ?? 0,
    paidMaps.paidByCampaign,
    paidMaps.paidToTestersByCampaign,
  );
}

export async function patchCampaign(
  campaignId: string,
  clientId: string,
  data: PatchCampaignDto,
) {
  const c = await prisma.campaign.findFirst({
    where: { id: campaignId, clientId },
  });
  if (!c) throw new NotFoundError("Campaign not found");

  if (
    data.status !== undefined &&
    c.status === CampaignStatus.draft &&
    (data.status === CampaignStatus.active ||
      data.status === CampaignStatus.paused ||
      data.status === CampaignStatus.ended)
  ) {
    throw new ValidationError(
      "Cannot change status from draft until the campaign is funded. Fund the campaign first.",
    );
  }

  if (data.listed === true && !c.escrowPda) {
    throw new ValidationError(
      "Fund your campaign to initialize escrow before listing.",
    );
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.scope !== undefined ? { scope: data.scope } : {}),
      ...(data.outOfScope !== undefined ? { outOfScope: data.outOfScope } : {}),
      ...(data.inScopeTestCaseUrl !== undefined
        ? { inScopeTestCaseUrl: data.inScopeTestCaseUrl }
        : {}),
      ...(data.disclosureGuidelines !== undefined
        ? { disclosureGuidelines: data.disclosureGuidelines }
        : {}),
      ...(data.rewardEligibility !== undefined
        ? { rewardEligibility: data.rewardEligibility }
        : {}),
      ...(data.downloadLinks !== undefined
        ? { downloadLinks: data.downloadLinks as Prisma.InputJsonValue }
        : {}),
      ...(data.startDate !== undefined
        ? { startDate: parseOptionalDate(data.startDate) }
        : {}),
      ...(data.endDate !== undefined
        ? { endDate: parseOptionalDate(data.endDate) }
        : {}),
      ...(data.isApproved !== undefined ? { isApproved: data.isApproved } : {}),
      ...(data.deviceRequirements !== undefined
        ? { deviceRequirements: data.deviceRequirements }
        : {}),
      ...(data.visibility !== undefined ? { visibility: data.visibility } : {}),
      ...(data.listed !== undefined ? { listed: data.listed } : {}),
      ...(data.reviewWindowDays !== undefined
        ? { reviewWindowDays: data.reviewWindowDays }
        : {}),
      ...(data.severityRewards !== undefined
        ? {
            severityRewards: data.severityRewards as Prisma.InputJsonValue,
          }
        : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  });
  return loadCampaignUi(campaignId);
}

export async function fundCampaign(
  campaignId: string,
  clientId: string,
  input: FundCampaignDto,
) {
  const c = await prisma.campaign.findFirst({
    where: { id: campaignId, clientId },
  });
  if (!c) throw new NotFoundError("Campaign not found");
  if (c.escrowPda) {
    throw new ValidationError("Campaign is already funded");
  }

  const funded = toDecimal(input.fundedUsdc);
  const creationFee = toDecimal("25");

  const escrowPda = stubEscrowPda(campaignId);

  await prisma.$transaction(async (tx) => {
    await tx.campaignFee.create({
      data: {
        campaignId,
        clientId,
        amount: creationFee,
        txSignature: input.initializeTxSignature || stubTxSignature("fee"),
      },
    });

    await tx.campaign.update({
      where: { id: campaignId },
      data: {
        escrowPda,
        creationFeePaid: true,
        budget: funded,
        budgetRemaining: funded,
        availableBalance: funded,
        allocatedBalance: new Prisma.Decimal(0),
        status: CampaignStatus.active,
        listed: false,
      },
    });
  });

  const campaign = await loadCampaignUi(campaignId);
  return {
    campaign,
    chain: {
      pendingProgramConfirmation: true,
      escrowPda,
      initializeTx: input.initializeTxSignature,
      fundTx: input.fundTxSignature,
    },
  };
}

export async function topUpCampaign(
  campaignId: string,
  clientId: string,
  input: TopUpCampaignDto,
) {
  const c = await prisma.campaign.findFirst({
    where: { id: campaignId, clientId },
  });
  if (!c) throw new NotFoundError("Campaign not found");
  if (!c.escrowPda) throw new ValidationError("Campaign has no escrow yet");

  const add = toDecimal(input.amountUsdc);
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      budget: c.budget.plus(add),
      budgetRemaining: c.budgetRemaining.plus(add),
      availableBalance: c.availableBalance.plus(add),
      status:
        c.status === CampaignStatus.ended ? CampaignStatus.active : c.status,
    },
  });

  const campaign = await loadCampaignUi(campaignId);
  return {
    campaign,
    chain: { pendingProgramConfirmation: true, topUpTx: input.txSignature },
  };
}

export async function closeCampaign(
  campaignId: string,
  clientId: string,
  _closeTxSignature?: string,
) {
  const c = await prisma.campaign.findFirst({
    where: { id: campaignId, clientId },
  });
  if (!c) throw new NotFoundError("Campaign not found");
  if (c.allocatedBalance.gt(0)) {
    throw new ValidationError(
      "Cannot close while submissions have allocated funds — resolve submissions first",
    );
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: CampaignStatus.ended,
      budgetRemaining: new Prisma.Decimal(0),
      availableBalance: new Prisma.Decimal(0),
    },
  });

  const campaign = await loadCampaignUi(campaignId);
  return {
    campaign,
    chain: {
      pendingProgramConfirmation: true,
      closeTx: _closeTxSignature ?? stubTxSignature("close"),
    },
  };
}
