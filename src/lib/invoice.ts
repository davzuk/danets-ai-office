import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";

/**
 * Generate a unique invoice number of the shape `INV-<unix-ms>-<4hex>`.
 * Exposed so tests + admin tools can predict the format without re-deriving it.
 */
export function generateInvoiceNumber() {
  return `INV-${Date.now()}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type CreateInvoiceForPaymentParams = {
  businessId: string;
  subscriptionId: string;
  paymentId: string;
  planName: string;
  billingCycle: "monthly" | "annual" | string;
  amount: number;
  currency: string;
  provider: string;
  reference: string;
  /** Optional override — defaults to a single line for the plan charge. */
  items?: InvoiceLineItem[];
  notes?: string;
};

/**
 * Idempotently create an Invoice for a given Payment. Safe to call multiple
 * times with the same `paymentId` — subsequent calls return the first row.
 *
 * Must be called inside a `db.$transaction` so the dedupe check + insert are
 * a single atomic unit. Callers that don't already have a transaction can
 * wrap the call in `db.$transaction(async (tx) => createInvoiceForPayment(tx, …))`.
 */
export async function createInvoiceForPayment(
  tx: Prisma.TransactionClient,
  params: CreateInvoiceForPaymentParams
) {
  const existing = await tx.invoice.findFirst({
    where: { paymentId: params.paymentId },
  });
  if (existing) return existing;

  const items: InvoiceLineItem[] = params.items ?? [
    {
      description: `${params.planName} plan (${params.billingCycle})`,
      quantity: 1,
      unitPrice: params.amount,
      total: params.amount,
    },
  ];

  return tx.invoice.create({
    data: {
      businessId: params.businessId,
      subscriptionId: params.subscriptionId,
      paymentId: params.paymentId,
      invoiceNumber: generateInvoiceNumber(),
      amount: params.amount,
      currency: params.currency,
      status: "paid",
      paidAt: new Date(),
      dueDate: new Date(),
      items: JSON.stringify(items),
      notes:
        params.notes ?? `Payment via ${params.provider}. Reference: ${params.reference}`,
    },
  });
}