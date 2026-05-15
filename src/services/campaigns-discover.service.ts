import type { CampaignStatus, SubmissionStatus } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
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

function publicObjectUrl(objectKey: string | null | undefined): string | null {
  if (!objectKey?.trim() || !env.PUBLIC_OBJECT_BASE_URL) return null;
  const base = env.PUBLIC_OBJECT_BASE_URL.replace(/\/$/, "");
  const key = objectKey.replace(/^\//, "");
  return `${base}/${key}`;
}

const DISCOVER_STATUSES: CampaignStatus[] = ["active", "paused", "ended"];

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
export function toDiscoverCampaignPreviewCard(c: DiscoverRow) {
  const brandName = c.brand.brandProfile?.brandName ?? "Brand";
  const { totalBudget, consumedBudget } = discoverBudgetMetrics(c);
  return {
    id: c.id,
    brandName,
    title: c.title,
    description: c.description,
    status: c.status,
    platforms: c.platforms,
    coverImageUrl: publicObjectUrl(c.coverImageObjectKey),
    brandLogoUrl: publicObjectUrl(c.brand.brandProfile?.logoObjectKey ?? undefined),
    totalBudget,
    consumedBudget,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Public campaign detail — brief + rules/assets + budget headline (no gross / available breakdown). */
export function toDiscoverCampaignPublicDetail(c: DiscoverRow) {
  const brandName = c.brand.brandProfile?.brandName ?? "Brand";
  const { totalBudget, consumedBudget } = discoverBudgetMetrics(c);
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
    coverImageUrl: publicObjectUrl(c.coverImageObjectKey),
    brandLogoUrl: publicObjectUrl(c.brand.brandProfile?.logoObjectKey ?? undefined),
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

  return rows.map((r) => toDiscoverCampaignPreviewCard(r));
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
