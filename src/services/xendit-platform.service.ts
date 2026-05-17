import { Prisma } from "../generated/prisma/client.js";
import { LedgerType, SessionStatus } from "../generated/prisma/enums.js";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import type { NormalizedXenditAccountWebhook } from "./xendit-webhook-payload.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const PAYMENT_UNAVAILABLE =
  "We could not reach the payment provider. Try again in a moment.";

export type XenditSubAccountStatus =
  | "INVITED"
  | "REGISTERED"
  | "AWAITING_DOCS"
  | "PENDING_VERIFICATION"
  | "LIVE"
  | "SUSPENDED"
  | string;

type XenditAccountSnapshot = {
  id: string;
  status: string;
};

type XenditTransferSnapshot = {
  reference: string;
  status: string;
};

function xenditAuthHeader(): string {
  if (!env.XENDIT_SECRET_KEY?.trim()) {
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }
  return `Basic ${Buffer.from(`${env.XENDIT_SECRET_KEY}:`).toString("base64")}`;
}

function initialTransferReference(fundingExternalId: string): string {
  return `xfer_initial_${fundingExternalId}`;
}

export function isXenPlatformEnabled(): boolean {
  return Boolean(env.XENDIT_SECRET_KEY?.trim());
}

export function isXenditSubAccountLive(status: string | null | undefined): boolean {
  return status?.toUpperCase() === "LIVE";
}

async function getBrandXenditProfile(brandUserId: string) {
  return prisma.brandProfile.findUnique({
    where: { userId: brandUserId },
    select: {
      userId: true,
      xenditSubAccountId: true,
      xenditSubAccountStatus: true,
      xenditPendingInitialTransferAmount: true,
      xenditPendingInitialTransferRef: true,
      xenditInitialTransferCompletedAt: true,
    },
  });
}

/**
 * Brands can create campaigns before completing profile onboarding.
 * xenPlatform needs a `brand_profile` row — create a minimal one from `user` when missing.
 */
async function getOrCreateBrandProfileForXendit(brandUserId: string): Promise<{
  userId: string;
  brandName: string;
  user: { email: string };
} | null> {
  const existing = await prisma.brandProfile.findUnique({
    where: { userId: brandUserId },
    select: { userId: true, brandName: true, user: { select: { email: true } } },
  });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: brandUserId },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    logger.warn("xenPlatform: user not found for brand", { brandUserId });
    return null;
  }

  const brandName =
    user.name?.trim() || user.email.split("@")[0]?.trim() || "Brand";

  const created = await prisma.brandProfile.create({
    data: { userId: brandUserId, brandName },
    select: { userId: true, brandName: true, user: { select: { email: true } } },
  });

  logger.info("xenPlatform: auto-created brand_profile for payments", {
    brandUserId,
    brandName,
  });

  return created;
}

async function findReconcileFundingSession(brandUserId: string) {
  const onMaster = await prisma.fundingCheckoutSession.findFirst({
    where: {
      campaign: { brandUserId },
      status: SessionStatus.paid,
      xenditSubAccountId: null,
    },
    orderBy: { createdAt: "asc" },
  });
  if (onMaster) return { session: onMaster, masterCheckout: true };

  const anyPaid = await prisma.fundingCheckoutSession.findFirst({
    where: {
      campaign: { brandUserId },
      status: SessionStatus.paid,
    },
    orderBy: { createdAt: "asc" },
  });
  if (anyPaid) {
    return {
      session: anyPaid,
      masterCheckout: anyPaid.xenditSubAccountId == null,
    };
  }

  const initialDeposit = await prisma.ledgerEntry.findFirst({
    where: {
      campaign: { brandUserId },
      ledgerType: LedgerType.deposit,
      note: "initial_fund",
    },
    orderBy: { createdAt: "asc" },
    select: { campaignId: true },
  });
  if (!initialDeposit) return null;

  const fromLedger = await prisma.fundingCheckoutSession.findFirst({
    where: {
      campaignId: initialDeposit.campaignId,
      status: SessionStatus.paid,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!fromLedger) return null;

  return {
    session: fromLedger,
    masterCheckout: fromLedger.xenditSubAccountId == null,
  };
}

/**
 * Catch up xenPlatform when first fund succeeded before profile/sub-account/transfer completed.
 * Runs on Budget tab (transactions), checkout, Apply credit, and account webhooks.
 */
export async function reconcileMissedInitialXenditSetup(brandUserId: string): Promise<void> {
  if (!isXenPlatformEnabled()) return;

  await getOrCreateBrandProfileForXendit(brandUserId);

  const profile = await getBrandXenditProfile(brandUserId);
  if (profile?.xenditInitialTransferCompletedAt) return;

  const found = await findReconcileFundingSession(brandUserId);
  if (!found) return;

  const { session, masterCheckout } = found;

  /** Option 2 (master collect + split): no manual master→sub transfer. */
  if (session.xenditSplitRuleId) {
    await ensureBrandXenditSubAccount(brandUserId);
    return;
  }

  const grossAmountPhp = Number(session.grossAmount.toString());

  logger.info("xenPlatform: reconciling missed initial fund setup (legacy transfer)", {
    brandUserId,
    externalId: session.externalId,
    masterCheckout,
    hasSubAccount: Boolean(profile?.xenditSubAccountId),
  });

  if (profile?.xenditSubAccountId && !masterCheckout) {
    await transferInitialFundToBrandSubAccount(brandUserId, {
      grossAmountPhp,
      fundingExternalId: session.externalId,
    });
    return;
  }

  if (profile?.xenditSubAccountId && masterCheckout) {
    await flushPendingInitialTransferIfReady(brandUserId);
    return;
  }

  await provisionBrandXenditSubAccountAfterFirstFund(brandUserId, {
    grossAmountPhp,
    fundingExternalId: session.externalId,
    masterCheckout,
  });
}

/** Raw sub-account id (any status). */
export async function getBrandXenditSubAccountId(
  brandUserId: string,
): Promise<string | null> {
  const profile = await getBrandXenditProfile(brandUserId);
  return profile?.xenditSubAccountId ?? null;
}

/** Sub-account id for `for-user-id` — only when Xendit reports LIVE. */
export async function getBrandXenditForUserId(
  brandUserId: string,
): Promise<string | null> {
  const profile = await getBrandXenditProfile(brandUserId);
  if (!profile?.xenditSubAccountId) return null;
  if (!isXenditSubAccountLive(profile.xenditSubAccountStatus)) return null;
  return profile.xenditSubAccountId;
}

export async function getXenditAccount(accountId: string): Promise<XenditAccountSnapshot> {
  const res = await fetch(`https://api.xendit.co/v2/accounts/${encodeURIComponent(accountId)}`, {
    headers: { Authorization: xenditAuthHeader() },
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn("xenPlatform: get account failed", {
      accountId,
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }
  const data = (await res.json()) as { id?: string; status?: string };
  if (!data.id || !data.status) {
    throw new Error("Xendit account: missing id or status");
  }
  return { id: data.id, status: data.status };
}

async function getXenditTransferByReference(
  reference: string,
): Promise<XenditTransferSnapshot | null> {
  const res = await fetch(
    `https://api.xendit.co/transfers/reference=${encodeURIComponent(reference)}`,
    { headers: { Authorization: xenditAuthHeader() } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    logger.warn("xenPlatform: get transfer failed", {
      reference,
      status: res.status,
      body: text.slice(0, 500),
    });
    return null;
  }
  const data = (await res.json()) as { reference?: string; status?: string };
  if (!data.reference || !data.status) return null;
  return { reference: data.reference, status: data.status };
}

async function createXenditTransfer(input: {
  reference: string;
  amountPhp: number;
  sourceUserId: string;
  destinationUserId: string;
}): Promise<XenditTransferSnapshot> {
  const amount = Math.round(input.amountPhp * 100) / 100;
  const res = await fetch("https://api.xendit.co/transfers", {
    method: "POST",
    headers: {
      Authorization: xenditAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reference: input.reference,
      amount,
      source_user_id: input.sourceUserId,
      destination_user_id: input.destinationUserId,
    }),
  });

  if (res.status === 425) {
    const existing = await getXenditTransferByReference(input.reference);
    if (existing) return existing;
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Xendit transfer failed: ${res.status} ${text.slice(0, 500)}`);
    (err as Error & { xenditBody?: string }).xenditBody = text;
    throw err;
  }

  const data = (await res.json()) as { reference?: string; status?: string };
  if (!data.reference || !data.status) {
    throw new Error("Xendit transfer: missing reference or status");
  }
  return { reference: data.reference, status: data.status };
}

async function markInitialTransferCompleted(
  brandUserId: string,
  reference: string,
): Promise<void> {
  await prisma.brandProfile.update({
    where: { userId: brandUserId },
    data: {
      xenditPendingInitialTransferAmount: null,
      xenditPendingInitialTransferRef: null,
      xenditInitialTransferCompletedAt: new Date(),
    },
  });
  logger.info("xenPlatform: initial fund transferred master → sub-account", {
    brandUserId,
    reference,
  });
}

async function setPendingInitialTransfer(
  brandUserId: string,
  amountPhp: number,
  fundingExternalId: string,
  subAccountStatus: string,
): Promise<void> {
  await prisma.brandProfile.update({
    where: { userId: brandUserId },
    data: {
      xenditPendingInitialTransferAmount: new Prisma.Decimal(amountPhp),
      xenditPendingInitialTransferRef: initialTransferReference(fundingExternalId),
      xenditSubAccountStatus: subAccountStatus,
    },
  });
  logger.info("xenPlatform: initial transfer queued until sub-account LIVE", {
    brandUserId,
    amountPhp,
    subAccountStatus,
    fundingExternalId,
  });
}

/**
 * Move first-fund gross from master balance to brand sub-account (idempotent per funding ref).
 */
export async function transferInitialFundToBrandSubAccount(
  brandUserId: string,
  input: { grossAmountPhp: number; fundingExternalId: string },
): Promise<void> {
  const masterUserId = env.XENDIT_MASTER_USER_ID?.trim();
  if (!masterUserId) {
    logger.warn("xenPlatform: XENDIT_MASTER_USER_ID not set; cannot transfer initial fund", {
      brandUserId,
    });
    const subAccountId = await getBrandXenditSubAccountId(brandUserId);
    if (subAccountId) {
      const account = await getXenditAccount(subAccountId).catch(() => null);
      await setPendingInitialTransfer(
        brandUserId,
        input.grossAmountPhp,
        input.fundingExternalId,
        account?.status ?? "REGISTERED",
      );
    }
    return;
  }

  const profile = await getBrandXenditProfile(brandUserId);
  const subAccountId = profile?.xenditSubAccountId;
  if (!subAccountId) {
    logger.warn("xenPlatform: no sub-account for initial transfer", { brandUserId });
    return;
  }

  if (profile.xenditInitialTransferCompletedAt) {
    return;
  }

  const reference = initialTransferReference(input.fundingExternalId);
  const existing = await getXenditTransferByReference(reference);
  if (existing?.status === "SUCCESSFUL") {
    await markInitialTransferCompleted(brandUserId, reference);
    return;
  }

  let accountStatus = profile.xenditSubAccountStatus;
  try {
    const account = await getXenditAccount(subAccountId);
    accountStatus = account.status;
    await prisma.brandProfile.update({
      where: { userId: brandUserId },
      data: { xenditSubAccountStatus: account.status },
    });
  } catch {
    /* use cached status */
  }

  if (!isXenditSubAccountLive(accountStatus)) {
    await setPendingInitialTransfer(
      brandUserId,
      input.grossAmountPhp,
      input.fundingExternalId,
      accountStatus ?? "REGISTERED",
    );
    return;
  }

  try {
    const transfer = await createXenditTransfer({
      reference,
      amountPhp: input.grossAmountPhp,
      sourceUserId: masterUserId,
      destinationUserId: subAccountId,
    });
    if (transfer.status === "SUCCESSFUL" || transfer.status === "PENDING") {
      await markInitialTransferCompleted(brandUserId, reference);
    }
  } catch (err) {
    const body = (err as Error & { xenditBody?: string }).xenditBody ?? "";
    if (
      body.includes("XEN_PLATFORM_SUB_ACCOUNT_NOT_LIVE") ||
      body.includes("NOT_LIVE")
    ) {
      await setPendingInitialTransfer(
        brandUserId,
        input.grossAmountPhp,
        input.fundingExternalId,
        accountStatus ?? "REGISTERED",
      );
      return;
    }
    if (body.includes("INSUFFICIENT_BALANCE")) {
      logger.warn(
        "xenPlatform: initial transfer waiting for master cash balance (invoice may still be settling)",
        {
          brandUserId,
          reference,
          amountPhp: input.grossAmountPhp,
        },
      );
      await setPendingInitialTransfer(
        brandUserId,
        input.grossAmountPhp,
        input.fundingExternalId,
        accountStatus ?? "REGISTERED",
      );
      return;
    }
    logger.error("xenPlatform: initial transfer failed", {
      brandUserId,
      reference,
      error: err instanceof Error ? err.message : String(err),
      xenditBody: body.slice(0, 500),
    });
    await setPendingInitialTransfer(
      brandUserId,
      input.grossAmountPhp,
      input.fundingExternalId,
      accountStatus ?? "REGISTERED",
    );
  }
}

/** Keep Xendit Owned sub-account `public_profile.business_name` in sync with brand profile. */
export async function syncBrandXenditSubAccountProfile(
  brandUserId: string,
  brandName: string,
): Promise<void> {
  if (!isXenPlatformEnabled()) return;

  const trimmed = brandName.trim();
  if (!trimmed) return;

  const subAccountId = await getBrandXenditSubAccountId(brandUserId);
  if (!subAccountId) return;

  const res = await fetch(
    `https://api.xendit.co/v2/accounts/${encodeURIComponent(subAccountId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: xenditAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        public_profile: { business_name: trimmed.slice(0, 255) },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    logger.warn("xenPlatform: update sub-account business_name failed", {
      brandUserId,
      subAccountId,
      status: res.status,
      body: text.slice(0, 500),
    });
    return;
  }

  logger.info("xenPlatform: synced sub-account business_name", {
    brandUserId,
    subAccountId,
    brandName: trimmed,
  });
}

/**
 * Creates an Owned xenPlatform sub-account for a brand (master API key).
 * Idempotent: returns existing id when already stored.
 */
export async function ensureBrandXenditSubAccount(brandUserId: string): Promise<string | null> {
  if (!isXenPlatformEnabled()) {
    return null;
  }

  const profile = await getBrandXenditProfile(brandUserId);
  if (profile?.xenditSubAccountId) {
    return profile.xenditSubAccountId;
  }

  const brand = await getOrCreateBrandProfileForXendit(brandUserId);
  if (!brand) {
    return null;
  }

  const email = brand.user.email?.trim();
  if (!email) {
    logger.warn("xenPlatform: brand user has no email, skip sub-account create", { brandUserId });
    return null;
  }

  const businessName = brand.brandName.trim() || "Brand account";

  const res = await fetch("https://api.xendit.co/v2/accounts", {
    method: "POST",
    headers: {
      Authorization: xenditAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      type: "OWNED",
      public_profile: {
        business_name: businessName.slice(0, 255),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error("xenPlatform: create owned account failed", {
      brandUserId,
      status: res.status,
      body: text.slice(0, 1000),
    });
    return null;
  }

  const data = (await res.json()) as { id?: string; status?: string };
  if (!data.id) {
    logger.error("xenPlatform: create account response missing id", { brandUserId, data });
    return null;
  }

  try {
    await prisma.brandProfile.update({
      where: { userId: brandUserId },
      data: {
        xenditSubAccountId: data.id,
        xenditSubAccountStatus: data.status ?? "REGISTERED",
      },
    });
  } catch (err) {
    const raced = await getBrandXenditSubAccountId(brandUserId);
    if (raced) return raced;
    throw err;
  }

  logger.info("xenPlatform: owned sub-account created for brand", {
    brandUserId,
    xenditSubAccountId: data.id,
    xenditStatus: data.status,
  });

  return data.id;
}

export type ProvisionFirstFundInput = {
  grossAmountPhp: number;
  fundingExternalId: string;
  /** Checkout was on master (no sub-account at invoice creation). */
  masterCheckout: boolean;
};

/**
 * Legacy path: create sub-account after first fund and transfer master → sub when LIVE.
 * New checkouts use split rules (see `xendit-split.service`) and skip this transfer.
 */
export async function provisionBrandXenditSubAccountAfterFirstFund(
  brandUserId: string,
  input: ProvisionFirstFundInput,
): Promise<void> {
  await ensureBrandXenditSubAccount(brandUserId);

  if (!input.masterCheckout) {
    return;
  }

  await transferInitialFundToBrandSubAccount(brandUserId, {
    grossAmountPhp: input.grossAmountPhp,
    fundingExternalId: input.fundingExternalId,
  });
}

/** `account.created` / status updates — flush pending initial transfer when LIVE. */
async function linkXenditAccountToBrand(
  brandUserId: string,
  accountId: string,
  status: string,
): Promise<boolean> {
  const profile = await getBrandXenditProfile(brandUserId);
  if (profile?.xenditSubAccountId && profile.xenditSubAccountId !== accountId) {
    logger.warn("xenPlatform: brand already has a different sub-account id", {
      brandUserId,
      existing: profile.xenditSubAccountId,
      incoming: accountId,
    });
    return false;
  }

  await prisma.brandProfile.update({
    where: { userId: brandUserId },
    data: {
      xenditSubAccountId: accountId,
      xenditSubAccountStatus: status,
    },
  });
  return true;
}

async function refreshSubAccountStatusFromXendit(accountId: string): Promise<string> {
  try {
    const account = await getXenditAccount(accountId);
    return account.status;
  } catch {
    return "UNKNOWN";
  }
}

async function flushPendingInitialTransferIfReady(brandUserId: string): Promise<void> {
  const profile = await getBrandXenditProfile(brandUserId);
  if (!profile?.xenditSubAccountId) return;
  if (profile.xenditInitialTransferCompletedAt) return;
  if (!profile.xenditPendingInitialTransferAmount || !profile.xenditPendingInitialTransferRef) {
    return;
  }

  const accountStatus = await refreshSubAccountStatusFromXendit(profile.xenditSubAccountId);
  await prisma.brandProfile.update({
    where: { userId: brandUserId },
    data: { xenditSubAccountStatus: accountStatus },
  });

  if (!isXenditSubAccountLive(accountStatus)) {
    logger.info("xenPlatform: pending initial transfer — sub-account not LIVE yet", {
      brandUserId,
      accountStatus,
    });
    return;
  }

  const fundingExternalId = profile.xenditPendingInitialTransferRef.replace(
    /^xfer_initial_/,
    "",
  );
  const amountPhp = Number(profile.xenditPendingInitialTransferAmount.toString());

  await transferInitialFundToBrandSubAccount(brandUserId, {
    grossAmountPhp: amountPhp,
    fundingExternalId,
  });
}

export async function handleXenditAccountWebhook(
  webhook: NormalizedXenditAccountWebhook,
): Promise<void> {
  let brandUserId: string | null = null;

  const byAccountId = await prisma.brandProfile.findFirst({
    where: { xenditSubAccountId: webhook.accountId },
    select: { userId: true },
  });
  if (byAccountId) {
    brandUserId = byAccountId.userId;
  } else if (webhook.email) {
    const user = await prisma.user.findUnique({
      where: { email: webhook.email },
      select: { id: true },
    });
    if (user) {
      await getOrCreateBrandProfileForXendit(user.id);
      const linked = await linkXenditAccountToBrand(
        user.id,
        webhook.accountId,
        webhook.status,
      );
      if (linked) {
        brandUserId = user.id;
        logger.info("xenPlatform account webhook: linked sub-account by email", {
          accountId: webhook.accountId,
          brandUserId,
          email: webhook.email,
        });
      }
    }
  }

  if (!brandUserId) {
    logger.info("xenPlatform account webhook: no brand for account id", {
      accountId: webhook.accountId,
      event: webhook.event,
      email: webhook.email,
      webhookStatus: webhook.status,
    });
    return;
  }

  const accountStatus = await refreshSubAccountStatusFromXendit(webhook.accountId);
  await prisma.brandProfile.update({
    where: { userId: brandUserId },
    data: { xenditSubAccountStatus: accountStatus },
  });

  logger.info("xenPlatform account webhook received", {
    brandUserId,
    accountId: webhook.accountId,
    event: webhook.event,
    webhookStatus: webhook.status,
    xenditStatus: accountStatus,
  });

  await flushPendingInitialTransferIfReady(brandUserId);

  if (!isXenditSubAccountLive(accountStatus)) {
    return;
  }

  await reconcileMissedInitialXenditSetup(brandUserId);
}
