import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  beforeCursorWhere,
  clampPageSize,
  decodeCursor,
  encodeCursor,
} from "@/lib/cursor-pagination";

// GET /api/invoices — list invoices for the business. Supports
// ?status= filter and cursor-based pagination via ?cursor=<base64> /
// ?take=<n>. Ordered by createdAt desc.
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const cursor = decodeCursor(searchParams.get("cursor"));
  const take = clampPageSize(
    Number(searchParams.get("take") || 0) || undefined,
    50,
    100
  );

  const where: any = { businessId: user.businessId };
  if (status) where.status = status;
  Object.assign(where, beforeCursorWhere(cursor));

  const rows = await db.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    include: {
      payment: { select: { id: true, reference: true, provider: true, status: true } },
    },
  });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
    : null;

  return NextResponse.json({
    invoices: page.map((inv) => ({
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
    nextCursor,
  });
}