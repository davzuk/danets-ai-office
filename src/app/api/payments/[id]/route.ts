import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/payments/[id] — get payment details
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const payment = await db.payment.findFirst({
    where: { id, businessId: user.businessId },
    include: { invoice: true },
  });
  if (!payment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ payment });
}
