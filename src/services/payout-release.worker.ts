import { Prisma } from "../generated/prisma/client.js";
import type { Platform } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { insertLedgerEntry } from "./ledger.service.js";
import { maybeAutoPauseCampaign } from "./auto-pause.service.js";
import { env } from "../lib/env.js";
import {
  contentUrlFromNormalized,
  fetchCreatorContentStats,
} from "./platform-content.service.js";
import { AppError, ForbiddenError, ValidationError } from "../utils/errors.js";

/**
 * After brand confirms release: process each submission in `paying` state (stub payout if no Xendit).
 */
export async function processPayoutReleaseQueue(submissionIds: string[]): Promise<void> {
  for (const sid of submissionIds) {
    try {
      await processOneSubmissionPayout(sid);
    } catch (e) {
      console.error("payout worker", sid, e);
    }
  }
}

async function processOneSubmissionPayout(submissionId: string): Promise<void> {
  const s = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (!s || s.status !== "paying") return;

  const contentUrl = contentUrlFromNormalized(s.normalizedUrl, s.platform as Platform);
  try {
    await fetchCreatorContentStats(contentUrl, s.platform as Platform, s.creatorUserId);
  } catch (e) {
    if (isRejectedContentError(e)) {
      await rejectDeleted(s.id, s.campaignId, "content_deleted");
      return;
    }
    if (isPlatformAuthError(e)) {
      await failPayoutRelease(s, "platform_auth_required");
      return;
    }
    const reason =
      e instanceof AppError ? e.message.slice(0, 500) : "platform_stats_unavailable";
    await failPayoutRelease(s, reason);
    return;
  }

  const attemptAt = s.lastPayoutAttemptAt ?? new Date();
  const idemKey = `${s.id}:${attemptAt.toISOString()}`;

  if (!env.XENDIT_SECRET_KEY) {
    await prisma.$transaction(async (tx) => {
      const gross = s.grossAmount;
      const net = s.creatorNet;
      const xenditFee = new Prisma.Decimal(0);
      const platformFee = gross.sub(net).sub(xenditFee);
      await tx.ledgerEntry.create({
        data: {
          campaignId: s.campaignId,
          ledgerType: "release_attempt",
          amountGross: new Prisma.Decimal(0),
          relatedSubmissionId: s.id,
          idempotencyKey: `payout_attempt:${idemKey}`,
          xenditPayoutId: `dev_${idemKey}`,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          campaignId: s.campaignId,
          ledgerType: "release",
          amountGross: gross,
          amountNet: net,
          xenditPayoutId: `dev_${idemKey}`,
          xenditFeeAmount: xenditFee,
          platformFeeAmount: platformFee,
          relatedSubmissionId: s.id,
          idempotencyKey: `payout:${idemKey}`,
        },
      });
      await tx.submission.update({
        where: { id: s.id },
        data: { status: "paid", paidAt: new Date() },
      });
      await tx.campaign.update({
        where: { id: s.campaignId },
        data: { spentBudget: { increment: gross } },
      });
    });
    await maybeAutoPauseCampaign(s.campaignId);
    return;
  }

  // Real Xendit Create Payout would go here; mark payout_failed until integrated
  await insertLedgerEntry({
    campaignId: s.campaignId,
    ledgerType: "release_failed",
    amountGross: new Prisma.Decimal(0),
    relatedSubmissionId: s.id,
    failureReason: "xendit_payout_not_configured",
    idempotencyKey: `payout_failed:${idemKey}`,
  });
  await prisma.submission.update({
    where: { id: s.id },
    data: { status: "payout_failed" },
  });
}

async function rejectDeleted(
  submissionId: string,
  campaignId: string,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: { status: "rejected", rejectionReason: reason },
    });
  });
  await maybeAutoPauseCampaign(campaignId);
}

function isRejectedContentError(err: unknown): boolean {
  if (err instanceof ValidationError) return true;
  if (err instanceof ForbiddenError) {
    return (
      err.message === "tiktok_video_not_owned_or_missing" ||
      err.message === "instagram_media_not_found_or_not_owned"
    );
  }
  if (err instanceof AppError && err.statusCode === 404 && err.message === "facebook_object_not_found") {
    return true;
  }
  return false;
}

function isPlatformAuthError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return err.message === "platform_reconnect_required" || err.message === "creator_platform_not_connected";
}

async function failPayoutRelease(
  s: { id: string; campaignId: string; lastPayoutAttemptAt: Date | null },
  failureReason: string,
): Promise<void> {
  const attemptAt = s.lastPayoutAttemptAt ?? new Date();
  const idemKey = `${s.id}:${attemptAt.toISOString()}`;
  await insertLedgerEntry({
    campaignId: s.campaignId,
    ledgerType: "release_failed",
    amountGross: new Prisma.Decimal(0),
    relatedSubmissionId: s.id,
    failureReason,
    idempotencyKey: `payout_failed:${idemKey}`,
  });
  await prisma.submission.update({
    where: { id: s.id },
    data: { status: "payout_failed" },
  });
}
