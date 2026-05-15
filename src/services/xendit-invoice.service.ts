import { env } from "../lib/env.js";
import { Prisma } from "../generated/prisma/client.js";

type CreateInvoiceInput = {
  externalId: string;
  amount: Prisma.Decimal;
  description: string;
  metadata: Record<string, string>;
};

/**
 * Creates a Xendit v2 invoice (Payment Link). Without XENDIT_SECRET_KEY returns a dev stub URL.
 */
export async function createXenditInvoice(
  input: CreateInvoiceInput,
): Promise<{ invoiceId: string; invoiceUrl: string }> {
  if (!env.XENDIT_SECRET_KEY) {
    return {
      invoiceId: `dev_${input.externalId}`,
      invoiceUrl: `https://checkout.xendit.co/web/${input.externalId}`,
    };
  }
  const auth = Buffer.from(`${env.XENDIT_SECRET_KEY}:`).toString("base64");
  const res = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: input.externalId,
      amount: Number(input.amount.toString()),
      currency: "PHP",
      description: input.description,
      metadata: input.metadata,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xendit invoice failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id?: string; invoice_url?: string };
  if (!data.id || !data.invoice_url) {
    throw new Error("Xendit invoice: missing id or invoice_url");
  }
  return { invoiceId: data.id, invoiceUrl: data.invoice_url };
}
