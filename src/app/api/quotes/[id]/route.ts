import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/quotes/[id] — single quote request + all its generated documents,
// pricing line items, follow-ups, pricing totals, and acceptance details.
// Always verifies businessId ownership.
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  return withSession(async (user) => {
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        documents: {
          orderBy: { createdAt: "desc" },
        },
        items: {
          orderBy: { sortOrder: "asc" },
        },
        followups: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!quote) throw new Error("FORBIDDEN");

    return {
      quote: {
        id: quote.id,
        clientName: quote.clientName,
        companyName: quote.companyName,
        service: quote.service,
        requirements: quote.requirements,
        budgetRange: quote.budgetRange,
        timeline: quote.timeline,
        notes: quote.notes,
        status: quote.status,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        // Pricing
        subtotal: quote.subtotal,
        discount: quote.discount,
        discountType: quote.discountType,
        taxRate: quote.taxRate,
        taxAmount: quote.taxAmount,
        total: quote.total,
        currency: quote.currency,
        // Acceptance
        acceptedAt: quote.acceptedAt?.toISOString() || null,
        acceptedByName: quote.acceptedByName,
        acceptedByEmail: quote.acceptedByEmail,
        clientFeedback: quote.clientFeedback,
        // Template
        templateId: quote.templateId,
        // Relations
        documents: quote.documents.map((d) => ({
          id: d.id,
          title: d.title,
          content: d.content,
          type: d.type,
          createdAt: d.createdAt,
        })),
        items: quote.items.map((i) => ({
          id: i.id,
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
          sortOrder: i.sortOrder,
        })),
        followups: quote.followups.map((f) => ({
          id: f.id,
          type: f.type,
          content: f.content,
          scheduledFor: f.scheduledFor?.toISOString() || null,
          completedAt: f.completedAt?.toISOString() || null,
          createdByName: f.createdByName,
          createdAt: f.createdAt.toISOString(),
        })),
      },
    };
  });
}

const patchSchema = z.object({
  status: z
    .enum(["draft", "generated", "sent", "viewed", "accepted", "rejected"])
    .optional(),
  discount: z.number().min(0).optional(),
  discountType: z.enum(["percentage", "flat"]).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  currency: z.string().max(10).optional(),
});

// PATCH /api/quotes/[id] — update status and/or pricing fields (discount,
// discountType, taxRate, currency). Subtotal/taxAmount/total are recomputed
// server-side from the current line items + new discount/tax.
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  return withSession(async (user) => {
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!quote) throw new Error("FORBIDDEN");

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const d = parsed.data;
    const data: any = {};
    if (d.status) data.status = d.status;
    if (d.currency) data.currency = d.currency;

    // If discount / discountType / taxRate changed, recompute totals.
    if (
      d.discount !== undefined ||
      d.discountType !== undefined ||
      d.taxRate !== undefined
    ) {
      // Read current values to merge with the patch
      const current = await db.quoteRequest.findUnique({
        where: { id },
        select: {
          discount: true,
          discountType: true,
          taxRate: true,
        },
      });
      if (!current) throw new Error("FORBIDDEN");

      const discount = d.discount ?? current.discount;
      const discountType = d.discountType ?? current.discountType;
      const taxRate = d.taxRate ?? current.taxRate;

      if (d.discount !== undefined) data.discount = discount;
      if (d.discountType !== undefined) data.discountType = discountType;
      if (d.taxRate !== undefined) data.taxRate = taxRate;

      // Recompute subtotal from current items
      const items = await db.proposalItem.findMany({
        where: { quoteRequestId: id },
        select: { total: true },
      });
      const subtotal = items.reduce((sum, i) => sum + i.total, 0);
      const discountAmount =
        discountType === "percentage" ? (subtotal * discount) / 100 : discount;
      const afterDiscount = Math.max(0, subtotal - discountAmount);
      const taxAmount = (afterDiscount * taxRate) / 100;
      const total = afterDiscount + taxAmount;

      data.subtotal = subtotal;
      data.taxAmount = taxAmount;
      data.total = total;
    }

    const updated = await db.quoteRequest.update({
      where: { id },
      data,
    });

    return { quote: updated };
  });
}

// DELETE /api/quotes/[id] — delete quote request (verifies businessId ownership).
// Associated GeneratedDocuments are removed first; otherwise Prisma's SetNull
// would orphan them with a null quoteRequestId.
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  return withSession(async (user) => {
    const quote = await db.quoteRequest.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    });
    if (!quote) throw new Error("FORBIDDEN");

    await db.generatedDocument.deleteMany({
      where: { quoteRequestId: id },
    });
    await db.quoteRequest.delete({ where: { id } });

    return { ok: true, id };
  });
}
