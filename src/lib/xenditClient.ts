import { env } from "../lib/env.js";

function authHeader(): string {
  if (!env.XENDIT_SECRET_KEY) {
    throw new Error("XENDIT_SECRET_KEY is not configured");
  }
  const token = Buffer.from(`${env.XENDIT_SECRET_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

export async function xenditCreateInvoice(input: {
  externalId: string;
  amount: string;
  currency: string;
  description?: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  metadata?: Record<string, string>;
}): Promise<{ id: string; invoice_url: string }> {
  const res = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      external_id: input.externalId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      invoice_duration: 86400,
      success_redirect_url: input.successRedirectUrl,
      failure_redirect_url: input.failureRedirectUrl,
      metadata: input.metadata,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xendit invoice error: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id?: string; invoice_url?: string };
  if (!json.id || !json.invoice_url) {
    throw new Error("Xendit invoice response missing id or invoice_url");
  }
  return { id: json.id, invoice_url: json.invoice_url };
}

export async function xenditCreatePayout(input: {
  idempotencyKey: string;
  referenceId: string;
  channelCode: string;
  channelProperties: Record<string, string>;
  /** PHP amount — Xendit requires a JSON number, not a string. */
  amount: number;
  currency: string;
  /** xenPlatform sub-account id (`for-user-id`). */
  forUserId?: string | null;
}): Promise<{ id: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader(),
    "Idempotency-Key": input.idempotencyKey,
  };
  if (input.forUserId) {
    headers["for-user-id"] = input.forUserId;
  }
  const res = await fetch("https://api.xendit.co/v2/payouts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      reference_id: input.referenceId,
      channel_code: input.channelCode,
      channel_properties: input.channelProperties,
      amount: input.amount,
      currency: input.currency,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xendit payout error: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error("Xendit payout response missing id");
  }
  return { id: json.id };
}
