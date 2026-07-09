import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logActivity } from "@/lib/activity";
import { generateInvoiceNumber } from "@/lib/subscription-billing";

// GET /api/super-admin/invoices — platform-wide invoice list
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const businessId = searchParams.get("businessId") || undefined;

  const where: any = {};
  if (status) where.status = status;
  if (businessId) where.businessId = businessId;

  const invoices = await db.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      business: { select: { id: true, name: true, email: true } },
      payment: { select: { id: true, reference: true, provider: true, status: true } },
    },
  });

  return NextResponse.json({
    invoices: invoices.map((inv) => ({
      id: inv.id,
      businessId: inv.businessId,
      businessName: inv.business.name,
      businessEmail: inv.business.email,
      invoiceNumber: inv.invoiceNumber,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      dueDate: inv.dueDate?.toISOString() || null,
      paidAt: inv.paidAt?.toISOString() || null,
      items: JSON.parse(inv.items || "[]"),
      notes: inv.notes,
      payment: inv.payment,
      createdAt: inv.createdAt.toISOString(),
    })),
  });
}

const createSchema = z.object({
  businessId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().max(10).default("USD"),
  description: z.string().min(2).max(500),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
  status: z.enum(["draft", "sent"]).default("sent"),
});

// POST /api/super-admin/invoices — create a manual invoice for a tenant
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }

  const business = await db.business.findUnique({ where: { id: parsed.data.businessId } });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const subscription = await db.businessSubscription.findUnique({
    where: { businessId: parsed.data.businessId },
  });

  const invoice = await db.invoice.create({
    data: {
      businessId: parsed.data.businessId,
      subscriptionId: subscription?.id,
      invoiceNumber: generateInvoiceNumber(),
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      status: parsed.data.status,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      items: JSON.stringify([
        {
          description: parsed.data.description,
          quantity: 1,
          unitPrice: parsed.data.amount,
          total: parsed.data.amount,
        },
      ]),
      notes: parsed.data.notes || `Manual invoice created by super admin`,
    },
  });

  await logActivity({
    businessId: parsed.data.businessId,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "subscription_changed",
    module: "subscription",
    description: `Super admin created invoice ${invoice.invoiceNumber} for ${parsed.data.currency} ${parsed.data.amount}`,
    metadata: { invoiceId: invoice.id },
  });

  return NextResponse.json({ invoice });
}

const patchSchema = z.object({
  invoiceId: z.string().min(1),
  action: z.enum(["mark_paid", "void", "mark_sent", "mark_overdue"]),
});

// PATCH /api/super-admin/invoices — void, mark paid, sent, overdue
export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.success) return auth.error;
  const { user } = auth;

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }

  const invoice = await db.invoice.findUnique({
    where: { id: parsed.data.invoiceId },
    include: { business: { select: { name: true } } },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const statusMap: Record<string, string> = {
    mark_paid: "paid",
    void: "void",
    mark_sent: "sent",
    mark_overdue: "overdue",
  };
  const newStatus = statusMap[parsed.data.action];

  const updated = await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: newStatus,
      paidAt: parsed.data.action === "mark_paid" ? new Date() : invoice.paidAt,
    },
  });

  await logActivity({
    businessId: invoice.businessId,
    userId: user.userId,
    userName: `${user.name} (Super Admin)`,
    action: "subscription_changed",
    module: "subscription",
    description: `Super admin set invoice ${invoice.invoiceNumber} to ${newStatus}`,
    metadata: { invoiceId: invoice.id },
  });

  return NextResponse.json({ invoice: updated });
}
