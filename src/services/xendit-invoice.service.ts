import { env } from "../lib/env.js";
import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type CreateInvoiceInput = {
  externalId: string;
  amount: Prisma.Decimal;
  description: string;
  metadata: Record<string, string>;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  /** xenPlatform sub-account id (`for-user-id`). Omit for master-account checkouts. */
  forUserId?: string | null;
  /** Master-collect + split to sub (Option 2). */
  splitRuleId?: string | null;
};

export type XenditInvoiceSnapshot = {
  id: string;
  externalId: string;
  status: string;
  amount: number;
  paidAmount?: number;
};

const PAYMENT_UNAVAILABLE =
  "We could not reach the payment provider. Try again in a moment.";

function parseInvoiceRow(data: {
  id?: string;
  external_id?: string;
  status?: string;
  amount?: number;
  paid_amount?: number;
}): XenditInvoiceSnapshot {
  if (!data.id || !data.external_id || !data.status) {
    throw new Error("Xendit invoice: missing id, external_id, or status");
  }
  const amount =
    typeof data.paid_amount === "number"
      ? data.paid_amount
      : typeof data.amount === "number"
        ? data.amount
        : 0;
  return {
    id: data.id,
    externalId: data.external_id,
    status: data.status,
    amount,
    paidAmount: typeof data.paid_amount === "number" ? data.paid_amount : undefined,
  };
}

function logXenditHttpFailure(context: string, status: number, body: string): void {
  logger.warn("Xendit API request failed", {
    context,
    status,
    body: body.slice(0, 1000),
  });
}

function throwXenditApiError(context: string, status: number, body: string): never {
  logXenditHttpFailure(context, status, body);
  throw new AppError(PAYMENT_UNAVAILABLE, 503);
}

function xenditAuthHeader(): string {
  if (!env.XENDIT_SECRET_KEY?.trim()) {
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }
  return `Basic ${Buffer.from(`${env.XENDIT_SECRET_KEY}:`).toString("base64")}`;
}

function xenditRequestHeaders(
  forUserId?: string | null,
  splitRuleId?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = { Authorization: xenditAuthHeader() };
  if (forUserId) {
    headers["for-user-id"] = forUserId;
  }
  if (splitRuleId) {
    headers["with-split-rule"] = splitRuleId;
  }
  return headers;
}

/**
 * Creates a Xendit v2 invoice (Payment Link). Requires `XENDIT_SECRET_KEY`.
 */
export async function createXenditInvoice(
  input: CreateInvoiceInput,
): Promise<{
  invoiceId: string;
  invoiceUrl: string;
  forUserId: string | null;
  splitRuleId: string | null;
}> {
  const res = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: {
      ...xenditRequestHeaders(input.forUserId, input.splitRuleId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: input.externalId,
      amount: Number(input.amount.toString()),
      currency: "PHP",
      description: input.description,
      metadata: input.metadata,
      success_redirect_url: input.successRedirectUrl,
      failure_redirect_url: input.failureRedirectUrl,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throwXenditApiError("create_invoice", res.status, text);
  }
  const data = (await res.json()) as { id?: string; invoice_url?: string };
  if (!data.id || !data.invoice_url) {
    logger.error("Xendit create invoice: invalid response shape", { data });
    throw new AppError(PAYMENT_UNAVAILABLE, 503);
  }
  return {
    invoiceId: data.id,
    invoiceUrl: data.invoice_url,
    forUserId: input.forUserId ?? null,
    splitRuleId: input.splitRuleId ?? null,
  };
}

/**
 * Fetches invoice state from Xendit (for funding sync when webhooks are delayed or failed).
 */
export async function getXenditInvoice(
  invoiceId: string,
  forUserId?: string | null,
): Promise<XenditInvoiceSnapshot> {
  const res = await fetch(`https://api.xendit.co/v2/invoices/${encodeURIComponent(invoiceId)}`, {
    headers: xenditRequestHeaders(forUserId, null),
  });
  if (!res.ok) {
    const text = await res.text();
    throwXenditApiError("get_invoice", res.status, text);
  }
  const data = (await res.json()) as {
    id?: string;
    external_id?: string;
    status?: string;
    amount?: number;
    paid_amount?: number;
  };
  return parseInvoiceRow(data);
}

/** Resolves an invoice when only `external_id` is stored (older checkout sessions). */
export async function getXenditInvoiceByExternalId(
  externalId: string,
  forUserId?: string | null,
): Promise<XenditInvoiceSnapshot | null> {
  const res = await fetch(
    `https://api.xendit.co/v2/invoices?external_id=${encodeURIComponent(externalId)}`,
    { headers: xenditRequestHeaders(forUserId, null) },
  );
  if (!res.ok) {
    const text = await res.text();
    throwXenditApiError("list_invoices_by_external_id", res.status, text);
  }
  const body = (await res.json()) as
    | Array<{
        id?: string;
        external_id?: string;
        status?: string;
        amount?: number;
        paid_amount?: number;
      }>
    | {
        data?: Array<{
          id?: string;
          external_id?: string;
          status?: string;
          amount?: number;
          paid_amount?: number;
        }>;
      };
  const list = Array.isArray(body) ? body : (body.data ?? []);
  const row = list[0];
  if (!row?.id || !row.external_id || !row.status) return null;
  return parseInvoiceRow(row);
}

/** Best-effort lookup for transaction list; logs failures and returns null (no throw). */
export async function tryGetXenditInvoiceForSession(session: {
  xenditInvoiceId: string | null;
  externalId: string;
  xenditSubAccountId?: string | null;
  xenditSplitRuleId?: string | null;
}): Promise<XenditInvoiceSnapshot | null> {
  if (!env.XENDIT_SECRET_KEY?.trim()) return null;
  /** Master-collect + split: invoice on master (no for-user-id). Legacy: sub-scoped. */
  const forUserId = session.xenditSplitRuleId ? null : (session.xenditSubAccountId ?? null);
  try {
    if (session.xenditInvoiceId) {
      return await getXenditInvoice(session.xenditInvoiceId, forUserId);
    }
    return await getXenditInvoiceByExternalId(session.externalId, forUserId);
  } catch (err) {
    if (forUserId) {
      try {
        if (session.xenditInvoiceId) {
          return await getXenditInvoice(session.xenditInvoiceId, null);
        }
        return await getXenditInvoiceByExternalId(session.externalId, null);
      } catch {
        /* fall through */
      }
    }
    logger.warn("Xendit invoice status lookup failed", {
      externalId: session.externalId,
      invoiceId: session.xenditInvoiceId,
      forUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
