import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

const itemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().min(1).default(1),
  unitPrice: z.number().min(0).default(0),
});

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/quotes/[id]/items — list pricing items
export function GET(_req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!quote) throw new Error("FORBIDDEN");

    const items = await db.proposalItem.findMany({
      where: { quoteRequestId: id },
      orderBy: { sortOrder: "asc" },
    });

    return {
      items: items.map((i) => ({
        id: i.id,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        sortOrder: i.sortOrder,
      })),
    };
  });
}

// DELETE /api/quotes/[id]/items?itemId=xxx — remove a single pricing line item
// and recompute the quote's subtotal / taxAmount / total.
export function DELETE(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: {
        id: true,
        discount: true,
        discountType: true,
        taxRate: true,
      },
    });
    if (!quote) throw new Error("FORBIDDEN");

    const { searchParams } = new URL(req.url);
    const itemId = searchParams.get("itemId");
    if (!itemId) throw new Error("itemId query parameter is required");

    const existing = await db.proposalItem.findFirst({
      where: { id: itemId, quoteRequestId: id },
      select: { id: true },
    });
    if (!existing) throw new Error("Item not found");

    // Atomic: delete the item + recompute totals in one tx.
    await db.$transaction(async (tx) => {
      await tx.proposalItem.delete({ where: { id: itemId } });

      const items = await tx.proposalItem.findMany({
        where: { quoteRequestId: id },
        select: { total: true },
      });
      const subtotal = items.reduce((sum, i) => sum + i.total, 0);
      const discountAmount =
        quote.discountType === "percentage"
          ? (subtotal * quote.discount) / 100
          : quote.discount;
      const afterDiscount = Math.max(0, subtotal - discountAmount);
      const taxAmount = (afterDiscount * quote.taxRate) / 100;
      const total = afterDiscount + taxAmount;

      await tx.quoteRequest.update({
        where: { id },
        data: { subtotal, taxAmount, total },
      });
    });

    return { ok: true, id: itemId };
  });
}

// POST /api/quotes/[id]/items — add a pricing item
export function POST(req: NextRequest, { params }: RouteCtx) {
  return withSession(async (user) => {
    const { id } = await params;
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true, discount: true, discountType: true, taxRate: true },
    });
    if (!quote) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = itemSchema.safeParse(body);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid input");

    const d = parsed.data;
    const total = d.quantity * d.unitPrice;

    // Get current item count for sortOrder
    const count = await db.proposalItem.count({ where: { quoteRequestId: id } });

    // Atomic: create the item + recompute the quote's totals in one tx.
    // Without this, a crash between `create` and `update` leaves a stale
    // subtotal/total on the quote that doesn't match its line items.
    const { item, subtotal, taxAmount, total: grandTotal } =
      await db.$transaction(async (tx) => {
        const created = await tx.proposalItem.create({
          data: {
            quoteRequestId: id,
            description: d.description.trim(),
            quantity: d.quantity,
            unitPrice: d.unitPrice,
            total,
            sortOrder: count,
          },
        });

        const items = await tx.proposalItem.findMany({
          where: { quoteRequestId: id },
          select: { total: true },
        });
        const sub = items.reduce((sum, i) => sum + i.total, 0);
        const discountAmount =
          quote.discountType === "percentage"
            ? (sub * quote.discount) / 100
            : quote.discount;
        const afterDiscount = Math.max(0, sub - discountAmount);
        const tax = (afterDiscount * quote.taxRate) / 100;
        const tot = afterDiscount + tax;
        await tx.quoteRequest.update({
          where: { id },
          data: { subtotal: sub, taxAmount: tax, total: tot },
        });
        return { item: created, subtotal: sub, taxAmount: tax, total: tot };
      });

    return { item, subtotal, taxAmount, total: grandTotal };
  });
}

// Helper: recalculate subtotal, discount, tax, total
async function recalculateTotals(
  quoteId: string,
  discount: number,
  discountType: string,
  taxRate: number
) {
  const items = await db.proposalItem.findMany({
    where: { quoteRequestId: quoteId },
    select: { total: true },
  });
  const subtotal = items.reduce((sum, i) => sum + i.total, 0);
  const discountAmount =
    discountType === "percentage"
      ? (subtotal * discount) / 100
      : discount;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const taxAmount = (afterDiscount * taxRate) / 100;
  const total = afterDiscount + taxAmount;

  await db.quoteRequest.update({
    where: { id: quoteId },
    data: { subtotal, taxAmount, total },
  });
}
