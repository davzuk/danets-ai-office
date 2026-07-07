import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/quotes/[id]/copy — duplicate a proposal (with its items)
export async function POST(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const original = await db.quoteRequest.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true },
  });
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Create copy with "(Copy)" suffix
  const copy = await db.quoteRequest.create({
    data: {
      businessId: user.businessId,
      clientName: `${original.clientName} (Copy)`,
      companyName: original.companyName,
      service: original.service,
      requirements: original.requirements,
      budgetRange: original.budgetRange,
      timeline: original.timeline,
      notes: original.notes,
      status: "draft",
      subtotal: original.subtotal,
      discount: original.discount,
      discountType: original.discountType,
      taxRate: original.taxRate,
      taxAmount: original.taxAmount,
      total: original.total,
      currency: original.currency,
      templateId: original.templateId,
    },
  });

  // Copy items
  if (original.items.length > 0) {
    await db.proposalItem.createMany({
      data: original.items.map((i) => ({
        quoteRequestId: copy.id,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        sortOrder: i.sortOrder,
      })),
    });
  }

  return NextResponse.json({ quote: copy });
}
