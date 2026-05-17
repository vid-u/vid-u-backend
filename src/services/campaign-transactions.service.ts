import { Prisma } from "../generated/prisma/client.js";
import { LedgerType, SessionStatus } from "../generated/prisma/enums.js";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { AppError, NotFoundError, ValidationError } from "../utils/errors.js";
import { BRAND_REFUND_LEDGER_NOTE } from "./xendit-payout.service.js";
import {
  getXenditInvoice,
  getXenditInvoiceByExternalId,
  tryGetXenditInvoiceForSession,
} from "./xendit-invoice.service.js";
import { logger } from "../utils/logger.js";
import { PLATFORM_DEPOSIT_FEE_PERCENT } from "../config/fees.js";
import { reconcileMissedInitialXenditSetup } from "./xendit-platform.service.js";
import { applyFundingInvoicePaid } from "./xendit-webhook.service.js";

function decimalString(d: Prisma.Decimal): string {
  return d.toFixed(2);
}

function netFromGross(gross: Prisma.Decimal): Prisma.Decimal {
  return gross.mul(new Prisma.Decimal(1 - PLATFORM_DEPOSIT_FEE_PERCENT));
}

/** Shown in brand UI alert tooltip for expired funding checkouts. */
export const FUNDING_CHECKOUT_EXPIRED_REASON =
  "This checkout session expired before payment was completed. The payment link is no longer valid.";

/** Shown when a funding checkout fails at Xendit without a provider message. */
export const FUNDING_CHECKOUT_FAILED_REASON =
  "This checkout could not be completed. Start a new checkout to try again.";

/** Brand-facing transaction copy (status lives on the badge, not in the label). */
export const TX_DESCRIPTION_REFUND_AVAILABLE_BALANCE = "Refund available balance";
export const TX_DESCRIPTION_RELEASE_CREATOR_PAYOUT = "Release creator payout";

/** Signed amount for brand UI — matches Xendit / bank movement when net is known. */
function signedDisplayAmount(input: {
  gross: Prisma.Decimal;
  net?: Prisma.Decimal | null;
  negative?: boolean;
  /** Checkout invoice / unpaid funding — brand pays gross at Xendit. */
  useGross?: boolean;
}): string {
  const magnitude = input.useGross
    ? input.gross
    : input.net != null && input.net.gt(0)
      ? input.net
      : netFromGross(input.gross);
  const s = decimalString(magnitude);
  return input.negative ? `-${s}` : s;
}

export type BrandCampaignTransactionKind =
  | "initial_fund"
  | "top_up"
  | "refund"
  | "refund_processing"
  | "creator_payout"
  | "payout_failed";

export type BrandCampaignTransactionStatus =
  | "completed"
  | "pending"
  | "failed"
  /** Checkout invoice expired at Xendit (e.g. after 24h) without payment. */
  | "expired"
  /** Checkout created; Xendit invoice not paid yet. */
  | "awaiting_payment"
  /** Xendit invoice PAID but ledger deposit not applied yet (webhook delay/failure). */
  | "awaiting_credit";

export type BrandCampaignTransactionDto = {
  id: string;
  kind: BrandCampaignTransactionKind;
  status: BrandCampaignTransactionStatus;
  /** Signed gross PHP (campaign pool ledger). */
  amountGross: string;
  /** Signed PHP for UI — net credited/sent where applicable; gross for unpaid checkout. */
  amountDisplay: string;
  createdAt: string;
  description: string;
  externalId?: string;
  canSync: boolean;
  /** Xendit hosted checkout URL while awaiting payment. */
  checkoutUrl?: string;
  failureReason?: string;
};

function fundingKindFromIntent(
  intent: string | null,
): "initial_fund" | "top_up" {
  return intent === "initial_publish" ? "initial_fund" : "top_up";
}

function ledgerToTransaction(row: {
  id: string;
  ledgerType: LedgerType;
  amountGross: Prisma.Decimal;
  amountNet: Prisma.Decimal | null;
  note: string | null;
  failureReason: string | null;
  createdAt: Date;
}): BrandCampaignTransactionDto | null {
  const grossDec = row.amountGross;
  const gross = decimalString(grossDec);
  const createdAt = row.createdAt.toISOString();

  if (row.ledgerType === LedgerType.deposit) {
    const kind = row.note === "initial_fund" ? "initial_fund" : "top_up";
    const display = signedDisplayAmount({
      gross: grossDec,
      net: row.amountNet,
    });
    return {
      id: row.id,
      kind,
      status: "completed",
      amountGross: gross,
      amountDisplay: display,
      createdAt,
      description: kind === "initial_fund" ? "Initial fund" : "Top up",
      canSync: false,
    };
  }

  if (row.ledgerType === LedgerType.refund_available) {
    if (row.note === "brand_refund_available") {
      return null;
    }
    const display = signedDisplayAmount({
      gross: grossDec,
      net: row.amountNet,
      negative: true,
    });
    return {
      id: row.id,
      kind: "refund",
      status: "completed",
      amountGross: `-${gross}`,
      amountDisplay: display,
      createdAt,
      description: TX_DESCRIPTION_REFUND_AVAILABLE_BALANCE,
      canSync: false,
    };
  }

  if (row.ledgerType === LedgerType.release) {
    const display = signedDisplayAmount({
      gross: grossDec,
      net: row.amountNet,
      negative: true,
    });
    return {
      id: row.id,
      kind: "creator_payout",
      status: "completed",
      amountGross: `-${gross}`,
      amountDisplay: display,
      createdAt,
      description: TX_DESCRIPTION_RELEASE_CREATOR_PAYOUT,
      canSync: false,
    };
  }

  if (row.ledgerType === LedgerType.release_failed) {
    if (row.note === "brand_refund_failed") {
      return null;
    }
    const display = signedDisplayAmount({
      gross: grossDec,
      net: row.amountNet,
      negative: true,
    });
    return {
      id: row.id,
      kind: "payout_failed",
      status: "failed",
      amountGross: `-${gross}`,
      amountDisplay: display,
      createdAt,
      description: TX_DESCRIPTION_RELEASE_CREATOR_PAYOUT,
      canSync: false,
      failureReason: row.failureReason ?? undefined,
    };
  }

  if (
    row.ledgerType === LedgerType.release_attempt &&
    row.note === `${BRAND_REFUND_LEDGER_NOTE}_pending`
  ) {
    return null;
  }

  return null;
}

type LedgerRowForTransactions = {
  id: string;
  ledgerType: LedgerType;
  amountGross: Prisma.Decimal;
  amountNet: Prisma.Decimal | null;
  note: string | null;
  failureReason: string | null;
  xenditPayoutId: string | null;
  createdAt: Date;
};

function isBrandRefundPendingRow(row: LedgerRowForTransactions): boolean {
  return (
    row.ledgerType === LedgerType.release_attempt &&
    row.note === `${BRAND_REFUND_LEDGER_NOTE}_pending`
  );
}

/** One brand refund line per payout attempt; status reflects settlement, not a second row. */
function brandRefundTransactionsFromLedger(
  ledgerRows: LedgerRowForTransactions[],
): { items: BrandCampaignTransactionDto[]; skipLedgerIds: Set<string> } {
  const skipLedgerIds = new Set<string>();
  const items: BrandCampaignTransactionDto[] = [];

  const successByPayoutId = new Map<string, LedgerRowForTransactions>();
  const failedByPayoutId = new Map<string, LedgerRowForTransactions>();

  for (const row of ledgerRows) {
    if (!row.xenditPayoutId) continue;
    if (row.ledgerType === LedgerType.refund_available && row.note === "brand_refund_available") {
      successByPayoutId.set(row.xenditPayoutId, row);
    }
    if (row.ledgerType === LedgerType.release_failed && row.note === "brand_refund_failed") {
      failedByPayoutId.set(row.xenditPayoutId, row);
    }
  }

  for (const attempt of ledgerRows) {
    if (!isBrandRefundPendingRow(attempt)) continue;

    const payoutId = attempt.xenditPayoutId;
    const success = payoutId ? successByPayoutId.get(payoutId) : undefined;
    const failed = payoutId ? failedByPayoutId.get(payoutId) : undefined;

    const grossDec = attempt.amountGross;
    const display = signedDisplayAmount({
      gross: grossDec,
      net: attempt.amountNet,
      negative: true,
    });
    const amountGross = `-${decimalString(grossDec)}`;
    const createdAt = attempt.createdAt.toISOString();

    if (success) {
      skipLedgerIds.add(success.id);
      items.push({
        id: attempt.id,
        kind: "refund",
        status: "completed",
        amountGross,
        amountDisplay: display,
        createdAt,
        description: TX_DESCRIPTION_REFUND_AVAILABLE_BALANCE,
        canSync: false,
      });
      continue;
    }

    if (failed) {
      skipLedgerIds.add(failed.id);
      items.push({
        id: attempt.id,
        kind: "refund",
        status: "failed",
        amountGross,
        amountDisplay: display,
        createdAt,
        description: TX_DESCRIPTION_REFUND_AVAILABLE_BALANCE,
        canSync: false,
        failureReason: failed.failureReason ?? undefined,
      });
      continue;
    }

    items.push({
      id: attempt.id,
      kind: "refund",
      status: "pending",
      amountGross,
      amountDisplay: display,
      createdAt,
      description: TX_DESCRIPTION_REFUND_AVAILABLE_BALANCE,
      canSync: false,
    });
  }

  return { items, skipLedgerIds };
}

type XenditFundingInvoiceState =
  | "PAID"
  | "EXPIRED"
  | "FAILED"
  | "OPEN"
  | "UNVERIFIED";

/** UNVERIFIED = Xendit unreachable; show Apply credit only (not open checkout). */
async function resolveXenditFundingInvoiceState(session: {
  xenditInvoiceId: string | null;
  externalId: string;
  xenditSubAccountId?: string | null;
}): Promise<XenditFundingInvoiceState> {
  if (!env.XENDIT_SECRET_KEY?.trim()) {
    logger.warn("Xendit status skipped: XENDIT_SECRET_KEY not set", {
      externalId: session.externalId,
    });
    return "UNVERIFIED";
  }

  const invoice = await tryGetXenditInvoiceForSession(session);
  if (!invoice) return "UNVERIFIED";
  if (invoice.status === "PAID") return "PAID";
  if (invoice.status === "EXPIRED") return "EXPIRED";
  if (invoice.status === "FAILED") return "FAILED";
  return "OPEN";
}

async function persistFundingSessionTerminal(
  sessionId: string,
  state: "EXPIRED" | "FAILED",
): Promise<void> {
  await prisma.fundingCheckoutSession.update({
    where: { id: sessionId },
    data: {
      status:
        state === "EXPIRED" ? SessionStatus.expired : SessionStatus.failed,
    },
  });
}

async function fundingSessionToTransaction(row: {
  id: string;
  externalId: string;
  xenditInvoiceId: string | null;
  intent: string | null;
  status: SessionStatus;
  grossAmount: Prisma.Decimal;
  checkoutUrl: string;
  createdAt: Date;
}): Promise<BrandCampaignTransactionDto> {
  const kind = fundingKindFromIntent(row.intent);
  const label = kind === "initial_fund" ? "Initial fund" : "Top up";
  const gross = decimalString(row.grossAmount);
  const createdAt = row.createdAt.toISOString();
  const displayPaid = signedDisplayAmount({
    gross: row.grossAmount,
    useGross: false,
  });
  const displayCheckout = signedDisplayAmount({
    gross: row.grossAmount,
    useGross: true,
  });

  if (row.status === SessionStatus.paid) {
    return {
      id: row.id,
      kind,
      status: "completed",
      amountGross: gross,
      amountDisplay: displayPaid,
      createdAt,
      description: label,
      externalId: row.externalId,
      canSync: false,
    };
  }

  if (row.status === SessionStatus.expired) {
    return {
      id: row.id,
      kind,
      status: "expired",
      amountGross: gross,
      amountDisplay: displayCheckout,
      createdAt,
      description: label,
      externalId: row.externalId,
      canSync: false,
      failureReason: FUNDING_CHECKOUT_EXPIRED_REASON,
    };
  }

  if (row.status === SessionStatus.failed) {
    return {
      id: row.id,
      kind,
      status: "failed",
      amountGross: gross,
      amountDisplay: displayCheckout,
      createdAt,
      description: label,
      externalId: row.externalId,
      canSync: false,
      failureReason: FUNDING_CHECKOUT_FAILED_REASON,
    };
  }

  const xenditState = await resolveXenditFundingInvoiceState(row);

  if (xenditState === "PAID") {
    return {
      id: row.id,
      kind,
      status: "awaiting_credit",
      amountGross: gross,
      amountDisplay: displayPaid,
      createdAt,
      description: label,
      externalId: row.externalId,
      canSync: true,
    };
  }

  if (xenditState === "EXPIRED") {
    await persistFundingSessionTerminal(row.id, "EXPIRED");
    return {
      id: row.id,
      kind,
      status: "expired",
      amountGross: gross,
      amountDisplay: displayCheckout,
      createdAt,
      description: label,
      externalId: row.externalId,
      canSync: false,
      failureReason: FUNDING_CHECKOUT_EXPIRED_REASON,
    };
  }

  if (xenditState === "FAILED") {
    await persistFundingSessionTerminal(row.id, "FAILED");
    return {
      id: row.id,
      kind,
      status: "failed",
      amountGross: gross,
      amountDisplay: displayCheckout,
      createdAt,
      description: label,
      externalId: row.externalId,
      canSync: false,
      failureReason: FUNDING_CHECKOUT_FAILED_REASON,
    };
  }

  if (xenditState === "UNVERIFIED") {
    return {
      id: row.id,
      kind,
      status: "awaiting_credit",
      amountGross: gross,
      amountDisplay: displayPaid,
      createdAt,
      description: label,
      externalId: row.externalId,
      canSync: true,
    };
  }

  return {
    id: row.id,
    kind,
    status: "awaiting_payment",
    amountGross: gross,
    amountDisplay: displayCheckout,
    createdAt,
    description: label,
    externalId: row.externalId,
    checkoutUrl: row.checkoutUrl,
    canSync: false,
  };
}

async function assertBrandOwnsCampaign(
  brandUserId: string,
  campaignId: string,
) {
  const c = await prisma.campaign.findFirst({
    where: { id: campaignId, brandUserId },
  });
  if (!c) throw new NotFoundError("Campaign not found");
  return c;
}

export async function listBrandCampaignTransactions(
  brandUserId: string,
  campaignId: string,
): Promise<{ items: BrandCampaignTransactionDto[] }> {
  await reconcileMissedInitialXenditSetup(brandUserId);
  await assertBrandOwnsCampaign(brandUserId, campaignId);

  const [ledgerRows, sessions, depositInvoiceIds] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        campaignId,
        ledgerType: {
          in: [
            LedgerType.deposit,
            LedgerType.refund_available,
            LedgerType.release,
            LedgerType.release_failed,
            LedgerType.release_attempt,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.fundingCheckoutSession.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        campaignId,
        ledgerType: LedgerType.deposit,
        xenditInvoiceId: { not: null },
      },
      select: { xenditInvoiceId: true },
    }),
  ]);

  const creditedInvoiceIds = new Set(
    depositInvoiceIds
      .map((r) => r.xenditInvoiceId)
      .filter((id): id is string => Boolean(id)),
  );

  const { items, skipLedgerIds } = brandRefundTransactionsFromLedger(ledgerRows);

  for (const row of ledgerRows) {
    if (skipLedgerIds.has(row.id) || isBrandRefundPendingRow(row)) continue;
    if (
      row.ledgerType === LedgerType.refund_available &&
      row.note === "brand_refund_available"
    ) {
      const grossDec = row.amountGross;
      items.push({
        id: row.id,
        kind: "refund",
        status: "completed",
        amountGross: `-${decimalString(grossDec)}`,
        amountDisplay: signedDisplayAmount({
          gross: grossDec,
          net: row.amountNet,
          negative: true,
        }),
        createdAt: row.createdAt.toISOString(),
        description: TX_DESCRIPTION_REFUND_AVAILABLE_BALANCE,
        canSync: false,
      });
      continue;
    }
    if (row.ledgerType === LedgerType.release_failed && row.note === "brand_refund_failed") {
      const grossDec = row.amountGross;
      items.push({
        id: row.id,
        kind: "refund",
        status: "failed",
        amountGross: `-${decimalString(grossDec)}`,
        amountDisplay: signedDisplayAmount({
          gross: grossDec,
          net: row.amountNet,
          negative: true,
        }),
        createdAt: row.createdAt.toISOString(),
        description: TX_DESCRIPTION_REFUND_AVAILABLE_BALANCE,
        canSync: false,
        failureReason: row.failureReason ?? undefined,
      });
      continue;
    }
    const tx = ledgerToTransaction(row);
    if (tx) items.push(tx);
  }

  for (const session of sessions) {
    if (
      session.xenditInvoiceId &&
      creditedInvoiceIds.has(session.xenditInvoiceId) &&
      session.status !== SessionStatus.pending
    ) {
      continue;
    }
    if (session.status === SessionStatus.paid && session.xenditInvoiceId) {
      const hasDeposit = creditedInvoiceIds.has(session.xenditInvoiceId);
      if (hasDeposit) continue;
    }
    items.push(await fundingSessionToTransaction(session));
  }

  items.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  return { items };
}

export async function syncBrandFundingCheckout(
  brandUserId: string,
  campaignId: string,
  externalId: string,
): Promise<{ items: BrandCampaignTransactionDto[]; applied: boolean }> {
  await reconcileMissedInitialXenditSetup(brandUserId);

  await assertBrandOwnsCampaign(brandUserId, campaignId);

  if (!externalId.startsWith("fund_")) {
    throw new ValidationError("Invalid checkout session id");
  }

  const session = await prisma.fundingCheckoutSession.findFirst({
    where: { externalId, campaignId },
  });
  if (!session) throw new NotFoundError("Checkout session not found");

  const forUserId = session.xenditSplitRuleId ? null : session.xenditSubAccountId;
  let invoice;
  try {
    invoice = session.xenditInvoiceId
      ? await getXenditInvoice(session.xenditInvoiceId, forUserId)
      : await getXenditInvoiceByExternalId(session.externalId, forUserId);
  } catch (firstErr) {
    if (forUserId) {
      try {
        invoice = session.xenditInvoiceId
          ? await getXenditInvoice(session.xenditInvoiceId, null)
          : await getXenditInvoiceByExternalId(session.externalId, null);
      } catch {
        /* use firstErr below */
      }
    }
    if (!invoice) {
      if (firstErr instanceof AppError) throw firstErr;
      logger.error("Apply credit: unexpected Xendit error", {
        externalId,
        error: firstErr instanceof Error ? firstErr.message : String(firstErr),
      });
      throw new AppError(
        "We could not reach the payment provider. Try again in a moment.",
        503,
      );
    }
  }

  if (!invoice) {
    throw new ValidationError(
      "Could not find this payment. Start a new checkout if you still need to pay.",
    );
  }

  if (!session.xenditInvoiceId) {
    await prisma.fundingCheckoutSession.update({
      where: { id: session.id },
      data: { xenditInvoiceId: invoice.id },
    });
  }

  if (invoice.status === "PAID") {
    const amount =
      invoice.paidAmount ??
      invoice.amount ??
      Number(session.grossAmount.toString());
    const { applied } = await applyFundingInvoicePaid({
      externalId: session.externalId,
      invoiceId: invoice.id,
      amount,
    });
    return {
      ...(await listBrandCampaignTransactions(brandUserId, campaignId)),
      applied,
    };
  }

  if (invoice.status === "EXPIRED") {
    await prisma.fundingCheckoutSession.update({
      where: { id: session.id },
      data: { status: SessionStatus.expired },
    });
  } else if (invoice.status === "FAILED") {
    await prisma.fundingCheckoutSession.update({
      where: { id: session.id },
      data: { status: SessionStatus.failed },
    });
  }

  return {
    ...(await listBrandCampaignTransactions(brandUserId, campaignId)),
    applied: false,
  };
}
