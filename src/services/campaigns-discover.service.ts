import type { CampaignStatus, SubmissionStatus } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { resolveObjectDisplayUrls } from "../lib/publicObjectUrl.js";
import { netBudgetFromGross, toDecimal } from "../utils/money.js";
import type { ListCampaignsQueryDto } from "../validation/campaigns-public.schema.js";

const RESERVED_SUBMISSION_STATUSES: SubmissionStatus[] = ["pending", "paying", "payout_failed"];

const discoverInclude = {
  brand: {
    select: {
      brandProfile: { select: { brandName: true, logoObjectKey: true } },
    },
  },
  submissions: {
    where: { status: { in: RESERVED_SUBMISSION_STATUSES } },
    select: { grossAmount: true },
  },
} satisfies Prisma.CampaignInclude;

type DiscoverRow = Prisma.CampaignGetPayload<{ include: typeof discoverInclude }>;

function decimalString(d: Prisma.Decimal): string {
  return d.toFixed(2);
}

const DISCOVER_STATUSES: CampaignStatus[] = ["active", "paused", "ended"];

async function discoverMediaUrls(c: DiscoverRow) {
  const logoKey = c.brand.brandProfile?.logoObjectKey ?? null;
  const [cover, logo] = await Promise.all([
    resolveObjectDisplayUrls(c.coverImageObjectKey),
    resolveObjectDisplayUrls(logoKey),
  ]);
  return {
    coverImageUrl: cover.url,
    coverImageFallbackUrl: cover.fallbackUrl,
    brandLogoUrl: logo.url,
    brandLogoFallbackUrl: logo.fallbackUrl,
  };
}

function statusFilter(status: ListCampaignsQueryDto["status"]): Prisma.EnumCampaignStatusFilter {
  if (status === "all") {
    return { in: DISCOVER_STATUSES };
  }
  return { equals: status };
}

/** Net pool after platform deposit fee, and funds no longer available (paid + reserved). */
function discoverBudgetMetrics(c: DiscoverRow): { totalBudget: string; consumedBudget: string } {
  let reserved = new Prisma.Decimal(0);
  for (const s of c.submissions) {
    reserved = reserved.add(s.grossAmount);
  }
  const totalBudget = netBudgetFromGross(c.grossBudget);
  const consumed = toDecimal(c.spentBudget).add(reserved);
  return {
    totalBudget: decimalString(totalBudget),
    consumedBudget: decimalString(consumed),
  };
}

/** Public list / marketing preview card — minimal fields + budget headline. */
export async function toDiscoverCampaignPreviewCard(c: DiscoverRow) {
  const brandName = c.brand.brandProfile?.brandName ?? "Brand";
  const { totalBudget, consumedBudget } = discoverBudgetMetrics(c);
  const media = await discoverMediaUrls(c);
  return {
    id: c.id,
    brandName,
    title: c.title,
    description: c.description,
    status: c.status,
    platforms: c.platforms,
    ...media,
    totalBudget,
    consumedBudget,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Public campaign detail — brief + rules/assets + budget headline (no gross / available breakdown). */
export async function toDiscoverCampaignPublicDetail(c: DiscoverRow) {
  const brandName = c.brand.brandProfile?.brandName ?? "Brand";
  const { totalBudget, consumedBudget } = discoverBudgetMetrics(c);
  const media = await discoverMediaUrls(c);
  return {
    id: c.id,
    brandName,
    title: c.title,
    description: c.description,
    status: c.status,
    platforms: c.platforms,
    rules: c.rules,
    referenceLinks: c.referenceLinks,
    assetUrls: c.assetUrls,
    ...media,
    ratePer1k: decimalString(c.ratePer1k),
    totalBudget,
    consumedBudget,
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listDiscoverCampaigns(query: ListCampaignsQueryDto) {
  const where: Prisma.CampaignWhereInput = {
    status: statusFilter(query.status),
    ...(query.platform ? { platforms: { array_contains: query.platform } } : {}),
  };

  const orderBy: Prisma.CampaignOrderByWithRelationInput[] =
    query.sort === "highest_rate"
      ? [{ ratePer1k: "desc" }, { updatedAt: "desc" }, { id: "desc" }]
      : [{ updatedAt: "desc" }, { id: "desc" }];

  const rows = await prisma.campaign.findMany({
    where,
    orderBy,
    take: 50,
    include: discoverInclude,
  });

  return Promise.all(rows.map((r) => toDiscoverCampaignPreviewCard(r)));
}

export async function getDiscoverCampaignById(id: string) {
  const c = await prisma.campaign.findFirst({
    where: {
      id,
      status: { in: DISCOVER_STATUSES },
    },
    include: discoverInclude,
  });
  if (!c) return null;
  return toDiscoverCampaignPublicDetail(c);
}
