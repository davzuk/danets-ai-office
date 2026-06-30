import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity, createNotification } from "@/lib/activity";

const verifySchema = z.object({
  reference: z.string().min(1),
  // For manual/bank_transfer, admin confirms manually
  // For paystack/flutterwave, this would be called after webhook
  status: z.enum(["success", "failed"]).default("success"),
});

// POST /api/payments/verify — verify/confirm a payment
// In production, this calls the provider's verification API:
// - Paystack: GET https://api.paystack.co/transaction/verify/:reference
// - Flutterwave: GET https://api.flutterwave.com/v3/transactions/:id/verify
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { reference, status } = parsed.data;

  const payment = await db.payment.findFirst({
    where: { reference, businessId: user.businessId },
  });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  if (payment.status !== "pending") {
    return NextResponse.json({ error: "Payment already processed" }, { status: 400 });
  }

  // Update payment status
  const updated = await db.payment.update({
    where: { id: payment.id },
    data: {
      status,
      paidAt: status === "success" ? new Date() : null,
      verifiedAt: new Date(),
      providerRef: `${payment.provider}_verified_${Date.now()}`,
    },
  });

  if (status === "success") {
    // Parse metadata for plan info
    let planName = "pro";
    let billingCycle = "monthly";
    try {
      const meta = JSON.parse(payment.metadata || "{}");
      planName = meta.planName || "pro";
      billingCycle = meta.billingCycle || "monthly";
    } catch {}

    // Get plan details
    const plan = await db.subscriptionPlan.findUnique({ where: { name: planName } });
    const monthlyFee = plan?.priceUsd || 0;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + (billingCycle === "annual" ? 12 : 1));

    // Update subscription
    let subscription = await db.businessSubscription.findUnique({
      where: { businessId: user.businessId },
    });

    if (subscription) {
      subscription = await db.businessSubscription.update({
        where: { id: subscription.id },
        data: {
          planName,
          status: "active",
          monthlyFee,
          endDate,
          paymentMethod: payment.provider,
          paymentRef: reference,
        },
      });
    } else {
      subscription = await db.businessSubscription.create({
        data: {
          businessId: user.businessId,
          planName,
          status: "active",
          monthlyFee,
          endDate,
          paymentMethod: payment.provider,
          paymentRef: reference,
        },
      });
    }

    // Update business plan
    await db.business.update({
      where: { id: user.businessId },
      data: { plan: planName },
    });

    // Link payment to subscription
    await db.payment.update({
      where: { id: payment.id },
      data: { subscriptionId: subscription.id },
    });

    // Generate invoice
    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const invoice = await db.invoice.create({
      data: {
        businessId: user.businessId,
        subscriptionId: subscription.id,
        paymentId: payment.id,
        invoiceNumber,
        amount: payment.amount,
        currency: payment.currency,
        status: "paid",
        paidAt: new Date(),
        dueDate: new Date(),
        items: JSON.stringify([
          {
            description: `${planName} plan (${billingCycle})`,
            quantity: 1,
            unitPrice: payment.amount,
            total: payment.amount,
          },
        ]),
        notes: `Payment via ${payment.provider}. Reference: ${reference}`,
      },
    });

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "subscription_changed",
      module: "subscription",
      description: `Payment confirmed: ${payment.currency} ${payment.amount} for ${planName} plan. Invoice ${invoiceNumber}.`,
      metadata: { paymentId: payment.id, invoiceId: invoice.id, planName },
    });

    await createNotification({
      businessId: user.businessId,
      type: "subscription_expiry",
      title: "Payment successful! ✅",
      message: `Your ${planName} plan is now active. Invoice ${invoiceNumber} generated.`,
      data: { paymentId: payment.id, invoiceId: invoice.id, planName },
    });

    return NextResponse.json({
      payment: updated,
      subscription,
      invoice: { id: invoice.id, invoiceNumber, amount: invoice.amount },
      message: "Payment verified successfully. Subscription activated.",
    });
  } else {
    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "subscription_changed",
      module: "subscription",
      description: `Payment failed: ${reference}`,
      metadata: { paymentId: payment.id, reference },
    });

    return NextResponse.json({
      payment: updated,
      message: "Payment verification failed.",
    });
  }
}
