import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// GET /api/invoices — list invoices for the business
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;

  const where: any = { businessId: user.businessId };
  if (status) where.status = status;

  const invoices = await db.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      payment: { select: { id: true, reference: true, provider: true, status: true } },
    },
  });

  return NextResponse.json({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      dueDate: inv.dueDate?.toISOString() || null,
      paidAt: inv.paidAt?.toISOString() || null,
      items: JSON.parse(inv.items || "[]"),
      notes: inv.notes,
      payment: inv.payment
        ? {
            id: inv.payment.id,
            reference: inv.payment.reference,
            provider: inv.payment.provider,
            status: inv.payment.status,
          }
        : null,
      createdAt: inv.createdAt.toISOString(),
    })),
  });
}
