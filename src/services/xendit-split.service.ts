import { CampaignStatus, SessionStatus } from "../generated/prisma/enums.js";
import { toDecimal } from "../utils/money.js";
import { ConflictError } from "../utils/errors.js";
import { prisma } from "../lib/prisma.js";
import { PLATFORM_DEPOSIT_FEE_PERCENT } from "../config/fees.js";
import { ensureBrandXenditSubAccount, isXenPlatformEnabled } from "./xendit-platform.service.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const PAYMENT_UNAVAILABLE =
  "We could not reach the payment provider. Try again in a moment.";

const BRAND_POOL_ROUTE_REF = "brand_pool";

/** Xendit split rule `name` / `description` allow only `[a-zA-Z0-9 ]`. */
function xenditSplitRuleText(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 255) || "VidU brand deposit pool";
}

function xenditAuthHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

/** Percent routed to brand sub-account on settlement (remainder stays on master = VidU deposit fee). */
export function brandPoolSplitPercent(): number {
  const pct = (1 - PLATFORM_DEPOSIT_FEE_PERCENT) * 100;
  return Math.round(pct * 100) / 100;
}

export type NormalizedXenditSplitWebhook = {
  event: string;
  splitPaymentId: string;
  splitRuleId: string;
  paymentId: string;
  paymentReferenceId: string | null;
  destinationAccountId: string;
  status: "COMPLETED" | "FAILED";
  amount: number;
  currency: string;
  failureCode: string | null;
};

export function parseXenditSplitWebhook(
  body: Record<string, unknown>,
): NormalizedXenditSplitWebhook | null {
  const event = typeof body.event === "string" ? body.event : "";
  if (event !== "split.payment") return null;

  const data =
    body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : null;
  if (!data) return null;

  const splitPaymentId = typeof data.id === "string" ? data.id : "";
  const splitRuleId = typeof data.split_rule_id === "string" ? data.split_rule_id : "";
  const paymentId = typeof data.payment_id === "string" ? data.payment_id : "";
  const destinationAccountId =
    typeof data.destination_account_id === "string" ? data.destination_account_id : "";
  const statusRaw = typeof data.status === "string" ? data.status.toUpperCase() : "";
  if (!splitPaymentId || !splitRuleId || !paymentId || !destinationAccountId) return null;
  if (statusRaw !== "COMPLETED" && statusRaw !== "FAILED") return null;

  const amount = typeof data.amount === "number" ? data.amount : 0;
  const currency = typeof data.currency === "string" ? data.currency : "PHP";
  const paymentReferenceId =
    typeof data.payment_reference_id === "string" ? data.payment_reference_id : null;
  const failureCode = typeof data.failure_code === "string" ? data.failure_code : null;

  return {
    event,
    splitPaymentId,
    splitRuleId,
    paymentId,
    paymentReferenceId,
    destinationAccountId,
    status: statusRaw as "COMPLETED" | "FAILED",
    amount,
    currency,
    failureCode,
  };
}

/**
 * Ensures a per-brand split rule: master-collected invoice → brand pool % to sub-account.
 */
export async function ensureBrandDepositSplitRule(
  brandUserId: string,
  subAccountId: string,
): Promise<string> {
  const secretKey = process.env.XENDIT_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }

  const profile = await prisma.brandProfile.findUnique({
    where: { userId: brandUserId },
    select: { xenditDepositSplitRuleId: true, brandName: true },
  });
  if (profile?.xenditDepositSplitRuleId) {
    return profile.xenditDepositSplitRuleId;
  }

  const percent = brandPoolSplitPercent();
  const res = await fetch("https://api.xendit.co/split_rules", {
    method: "POST",
    headers: {
      Authorization: xenditAuthHeader(secretKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: xenditSplitRuleText(`VidU brand pool ${brandUserId.slice(0, 8)}`),
      description: xenditSplitRuleText(
        `VidU deposit pool ${percent} percent gross to brand sub account`,
      ),
      routes: [
        {
          percent_amount: percent,
          currency: "PHP",
          destination_account_id: subAccountId,
          reference_id: BRAND_POOL_ROUTE_REF,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error("xenPlatform: create split rule failed", {
      brandUserId,
      subAccountId,
      status: res.status,
      body: text.slice(0, 1000),
    });
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }

  await prisma.brandProfile.update({
    where: { userId: brandUserId },
    data: { xenditDepositSplitRuleId: data.id },
  });

  logger.info("xenPlatform: deposit split rule created", {
    brandUserId,
    splitRuleId: data.id,
    subAccountId,
    percent,
  });

  return data.id;
}

/**
 * True when no paid checkout is waiting for Xendit split settlement on the brand sub-account.
 * When xenPlatform is off, always true.
 */
export async function isCampaignXenditPoolSettled(campaignId: string): Promise<boolean> {
  if (!isXenPlatformEnabled()) return true;

  const pendingSplit = await prisma.fundingCheckoutSession.count({
    where: {
      campaignId,
      status: SessionStatus.paid,
      xenditSplitRuleId: { not: null },
      xenditSplitSettledAt: null,
    },
  });
  return pendingSplit === 0;
}

export async function assertCampaignXenditPoolSettled(campaignId: string): Promise<void> {
  if (await isCampaignXenditPoolSettled(campaignId)) return;
  throw new ConflictError("xendit_settlement_pending");
}

/** Legacy rows: funding_pending after PAID → active (pool may still be settling). */
export async function reconcileLegacyFundingPendingCampaign(
  campaignId: string,
): Promise<void> {
  const c = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true, grossBudget: true },
  });
  if (c?.status !== CampaignStatus.funding_pending) return;
  if (toDecimal(c.grossBudget).lte(0)) return;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.active },
  });
}

/** Provision sub-account (and split rule when sub id exists) before checkout. */
export async function prepareBrandXenditForFunding(
  brandUserId: string,
): Promise<{ subAccountId: string; splitRuleId: string } | null> {
  if (!isXenPlatformEnabled()) return null;

  const subAccountId = await ensureBrandXenditSubAccount(brandUserId);
  if (!subAccountId) {
    throw new AppError(
      "We could not set up payments for your brand. Complete your profile and try again.",
      503,
    );
  }

  const splitRuleId = await ensureBrandDepositSplitRule(brandUserId, subAccountId);
  return { subAccountId, splitRuleId };
}

async function findFundingSessionForSplit(webhook: NormalizedXenditSplitWebhook) {
  if (webhook.paymentReferenceId?.startsWith("fund_")) {
    const byExternal = await prisma.fundingCheckoutSession.findUnique({
      where: { externalId: webhook.paymentReferenceId },
      include: { campaign: { select: { id: true, brandUserId: true, status: true } } },
    });
    if (byExternal) return byExternal;
  }

  const byInvoice = await prisma.fundingCheckoutSession.findFirst({
    where: { xenditInvoiceId: webhook.paymentId },
    include: { campaign: { select: { id: true, brandUserId: true, status: true } } },
  });
  if (byInvoice) return byInvoice;

  return prisma.fundingCheckoutSession.findFirst({
    where: {
      xenditSplitRuleId: webhook.splitRuleId,
      xenditSubAccountId: webhook.destinationAccountId,
      status: SessionStatus.paid,
      xenditSplitSettledAt: null,
    },
    orderBy: { createdAt: "desc" },
    include: { campaign: { select: { id: true, brandUserId: true, status: true } } },
  });
}

/**
 * After split.payment COMPLETED: mark session settled and activate campaign when appropriate.
 */
export async function applyFundingSplitSettled(
  webhook: NormalizedXenditSplitWebhook,
): Promise<void> {
  const session = await findFundingSessionForSplit(webhook);
  if (!session) {
    logger.warn("Split webhook: no funding session matched", {
      paymentId: webhook.paymentId,
      paymentReferenceId: webhook.paymentReferenceId,
      splitRuleId: webhook.splitRuleId,
    });
    return;
  }

  if (session.xenditSubAccountId && session.xenditSubAccountId !== webhook.destinationAccountId) {
    logger.warn("Split webhook: destination does not match session sub-account", {
      sessionId: session.id,
      expected: session.xenditSubAccountId,
      got: webhook.destinationAccountId,
    });
    return;
  }

  if (session.xenditSplitSettledAt) {
    return;
  }

  await prisma.fundingCheckoutSession.update({
    where: { id: session.id },
    data: { xenditSplitSettledAt: new Date() },
  });

  await prisma.brandProfile.updateMany({
    where: { userId: session.campaign.brandUserId },
    data: { xenditInitialTransferCompletedAt: new Date() },
  });

  logger.info("Funding split settled on brand sub-account", {
    campaignId: session.campaign.id,
    externalId: session.externalId,
  });
}

export async function handleXenditSplitPaymentWebhook(
  webhook: NormalizedXenditSplitWebhook,
): Promise<void> {
  if (webhook.status === "FAILED") {
    logger.error("Funding split payment failed", {
      splitPaymentId: webhook.splitPaymentId,
      paymentId: webhook.paymentId,
      failureCode: webhook.failureCode,
      destinationAccountId: webhook.destinationAccountId,
    });
    return;
  }

  await applyFundingSplitSettled(webhook);
}
