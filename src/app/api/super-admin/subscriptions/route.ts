import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";

// GET /api/super-admin/subscriptions — list all tenant subscriptions
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const plan = searchParams.get("plan") || undefined;
  const q = searchParams.get("q")?.trim() || undefined;

  const where: any = {};
  if (status) where.status = status;
  if (plan) where.planName = plan;
  if (q) {
    where.business = {
      OR: [{ name: { contains: q } }, { email: { contains: q } }],
    };
  }

  const subscriptions = await db.businessSubscription.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      business: {
        select: { id: true, name: true, email: true, plan: true, status: true },
      },
      _count: { select: { payments: true, invoices: true } },
    },
  });

  return NextResponse.json({
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      businessId: s.businessId,
      businessName: s.business.name,
      businessEmail: s.business.email,
      businessStatus: s.business.status,
      businessPlan: s.business.plan,
      planName: s.planName,
      status: s.status,
      monthlyFee: s.monthlyFee,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate?.toISOString() || null,
      trialEndsAt: s.trialEndsAt?.toISOString() || null,
      paymentMethod: s.paymentMethod,
      paymentRef: s.paymentRef,
      paymentCount: s._count.payments,
      invoiceCount: s._count.invoices,
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

const patchSchema = z.object({
  subscriptionId: z.string().min(1),
  status: z.enum(["active", "trial", "past_due", "canceled", "expired"]).optional(),
  planName: z.enum(["free", "starter", "pro", "enterprise"]).optional(),
  trialEndsAt: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  extendDays: z.number().int().min(1).max(365).optional(),
  compMonths: z.number().int().min(1).max(12).optional(),
});

// PATCH /api/super-admin/subscriptions — bulk update by subscriptionId in body
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }

  const sub = await db.businessSubscription.findUnique({
    where: { id: parsed.data.subscriptionId },
    include: { business: { select: { id: true, name: true } } },
  });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  const data: any = {};
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.planName) {
    data.planName = parsed.data.planName;
    const planRow = await db.subscriptionPlan.findUnique({
      where: { name: parsed.data.planName },
      select: { priceUsd: true },
    });
    data.monthlyFee = planRow?.priceUsd ?? 0;
  }
  if (parsed.data.trialEndsAt !== undefined) {
    data.trialEndsAt = parsed.data.trialEndsAt ? new Date(parsed.data.trialEndsAt) : null;
    if (parsed.data.trialEndsAt) data.status = "trial";
  }
  if (parsed.data.endDate !== undefined) {
    data.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  }
  if (parsed.data.extendDays) {
    const base = sub.endDate && sub.endDate > new Date() ? sub.endDate : new Date();
    data.endDate = new Date(base.getTime() + parsed.data.extendDays * 24 * 60 * 60 * 1000);
    data.status = "active";
  }
  if (parsed.data.compMonths) {
    const base = sub.endDate && sub.endDate > new Date() ? sub.endDate : new Date();
    const d = new Date(base);
    d.setMonth(d.getMonth() + parsed.data.compMonths);
    data.endDate = d;
    data.status = "active";
  }

  const updated = await db.$transaction(async (tx) => {
    const subscription = await tx.businessSubscription.update({
      where: { id: sub.id },
      data,
    });
    if (parsed.data.planName) {
      await tx.business.update({
        where: { id: sub.businessId },
        data: { plan: parsed.data.planName },
      });
    }
    return subscription;
  });

  await logActivity({
    businessId: sub.businessId,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "subscription_changed",
    module: "subscription",
    description: `Super admin updated subscription: ${Object.entries(data).map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString() : v}`).join(", ")}`,
  });

  return NextResponse.json({ subscription: updated });
}
