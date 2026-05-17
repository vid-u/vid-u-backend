/**
 * Normalizes Xendit webhook bodies (legacy flat v2 payouts/invoices and v3 `event` + `data`).
 */

export type NormalizedXenditInvoiceWebhook = {
  externalId: string;
  invoiceId: string;
  amount: number;
};

export type NormalizedXenditPayoutWebhook = {
  payoutId: string;
  referenceId: string;
  status: string;
  failureReason: string;
  feeAmount: number;
};

function payloadRecord(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return body;
}

function payoutStatusFromEvent(event: string | undefined): string | undefined {
  if (!event) return undefined;
  const normalized = event.toLowerCase();
  if (normalized === "payout.succeeded" || normalized.endsWith(".succeeded")) {
    return "SUCCEEDED";
  }
  if (normalized === "payout.failed" || normalized.endsWith(".failed")) {
    return "FAILED";
  }
  return undefined;
}

function invoiceStatusFromEvent(event: string | undefined): string | undefined {
  if (!event) return undefined;
  const normalized = event.toLowerCase();
  if (normalized === "invoice.paid" || normalized.endsWith(".paid")) {
    return "PAID";
  }
  return undefined;
}

export function parseXenditInvoiceWebhook(
  body: Record<string, unknown>,
): NormalizedXenditInvoiceWebhook | null {
  const event = typeof body.event === "string" ? body.event : undefined;
  const payload = payloadRecord(body);

  const externalId =
    typeof payload.external_id === "string"
      ? payload.external_id
      : typeof body.external_id === "string"
        ? body.external_id
        : undefined;

  if (!externalId?.startsWith("fund_")) {
    return null;
  }

  const invoiceId = typeof payload.id === "string" ? payload.id : undefined;
  const status =
    typeof payload.status === "string"
      ? payload.status.toUpperCase()
      : invoiceStatusFromEvent(event);

  const amount =
    typeof payload.paid_amount === "number"
      ? payload.paid_amount
      : typeof payload.amount === "number"
        ? payload.amount
        : undefined;

  if (status !== "PAID" || !invoiceId || amount === undefined) {
    return null;
  }

  return { externalId, invoiceId, amount };
}

export function parseXenditPayoutWebhook(
  body: Record<string, unknown>,
): NormalizedXenditPayoutWebhook | null {
  const event = typeof body.event === "string" ? body.event : undefined;
  if (event && !event.toLowerCase().startsWith("payout.")) {
    return null;
  }

  const payload = payloadRecord(body);

  const referenceId =
    typeof payload.reference_id === "string" ? payload.reference_id : undefined;
  const payoutId = typeof payload.id === "string" ? payload.id : undefined;

  let status =
    typeof payload.status === "string" ? payload.status.toUpperCase() : undefined;
  if (!status) {
    status = payoutStatusFromEvent(event);
  }

  if (!referenceId || !payoutId || !status) {
    return null;
  }

  const failureReason =
    typeof payload.failure_code === "string"
      ? payload.failure_code
      : typeof payload.reason === "string"
        ? payload.reason
        : "payout_failed";

  const feeAmount =
    typeof payload.fee_amount === "number"
      ? payload.fee_amount
      : typeof payload.fees === "object" &&
          payload.fees !== null &&
          typeof (payload.fees as Record<string, unknown>).xendit_fee === "number"
        ? ((payload.fees as Record<string, unknown>).xendit_fee as number)
        : 0;

  return { payoutId, referenceId, status, failureReason, feeAmount };
}
