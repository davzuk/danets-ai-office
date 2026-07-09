import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { activateSubscriptionFromPayment } from "@/lib/subscription-billing";

// GET /api/super-admin/payments — platform-wide payment list
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const businessId = searchParams.get("businessId") || undefined;
  const provider = searchParams.get("provider") || undefined;

  const where: any = {};
  if (status) where.status = status;
  if (businessId) where.businessId = businessId;
  if (provider) where.provider = provider;

  const payments = await db.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      business: { select: { id: true, name: true, email: true } },
      invoice: { select: { id: true, invoiceNumber: true, status: true } },
    },
  });

  return NextResponse.json({
    payments: payments.map((p) => ({
      id: p.id,
      businessId: p.businessId,
      businessName: p.business.name,
      businessEmail: p.business.email,
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      reference: p.reference,
      status: p.status,
      payerEmail: p.payerEmail,
      payerName: p.payerName,
      metadata: p.metadata ? JSON.parse(p.metadata) : null,
      paidAt: p.paidAt?.toISOString() || null,
      verifiedAt: p.verifiedAt?.toISOString() || null,
      createdAt: p.createdAt.toISOString(),
      invoice: p.invoice,
    })),
  });
}

const patchSchema = z.object({
  paymentId: z.string().min(1),
  action: z.enum(["mark_paid", "mark_failed", "refund"]),
  note: z.string().max(500).optional(),
});

// PATCH /api/super-admin/payments — mark paid, failed, or refund
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({
    where: { id: parsed.data.paymentId },
    include: { business: { select: { name: true } } },
  });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  if (parsed.data.action === "mark_paid") {
    if (payment.status === "success") {
      return NextResponse.json({ error: "Payment already marked as paid" }, { status: 400 });
    }
    const result = await activateSubscriptionFromPayment(payment.id, {
      actorName: user.name,
    });
    await logActivity({
      businessId: payment.businessId,
      userId: user.userId,
      userName: `${user.name} (Super Admin)`,
      action: "subscription_changed",
      module: "subscription",
      description: `Super admin marked payment ${payment.reference} as paid${parsed.data.note ? `: ${parsed.data.note}` : ""}`,
      metadata: { paymentId: payment.id },
    });
    return NextResponse.json({
      payment: result.payment,
      subscription: result.subscription,
      invoice: result.invoice,
    });
  }

  if (parsed.data.action === "mark_failed") {
    const updated = await db.payment.update({
      where: { id: payment.id },
      data: { status: "failed", verifiedAt: new Date() },
    });
    await logActivity({
      businessId: payment.businessId,
      userId: user.userId,
      userName: `${user.name} (Super Admin)`,
      action: "subscription_changed",
      module: "subscription",
      description: `Super admin marked payment ${payment.reference} as failed`,
    });
    return NextResponse.json({ payment: updated });
  }

  if (parsed.data.action === "refund") {
    if (payment.status !== "success") {
      return NextResponse.json({ error: "Only successful payments can be refunded" }, { status: 400 });
    }
    const updated = await db.payment.update({
      where: { id: payment.id },
      data: { status: "refunded" },
    });
    await logActivity({
      businessId: payment.businessId,
      userId: user.userId,
      userName: `${user.name} (Super Admin)`,
      action: "subscription_changed",
      module: "subscription",
      description: `Super admin refunded payment ${payment.reference}`,
    });
    return NextResponse.json({ payment: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
