import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity, createNotification } from "@/lib/activity";
import {
  verifyFlutterwaveTransaction,
  verifyPaystackTransaction,
} from "@/lib/payment-gateway";

const verifySchema = z.object({
  reference: z.string().min(1),
  status: z.enum(["success", "failed"]).optional(),
});

// POST /api/payments/verify — verify/confirm a payment (client callback or manual)
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

  const { reference } = parsed.data;

  const payment = await db.payment.findFirst({
    where: { reference, businessId: user.businessId },
  });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  if (payment.status !== "pending") {
    return NextResponse.json({ error: "Payment already processed" }, { status: 400 });
  }

  let status: "success" | "failed" = parsed.data.status ?? "success";
  let providerRef: string | undefined;

  if (payment.provider === "paystack") {
    const verified = await verifyPaystackTransaction(reference);
    if (process.env.PAYSTACK_SECRET_KEY) {
      status = verified.success ? "success" : "failed";
      providerRef = verified.providerRef;
    }
  } else if (payment.provider === "flutterwave") {
    const verified = await verifyFlutterwaveTransaction(reference);
    if (process.env.FLUTTERWAVE_SECRET_KEY) {
      status = verified.success ? "success" : "failed";
      providerRef = verified.providerRef;
    }
  }

  const updated = await db.payment.update({
    where: { id: payment.id },
    data: {
      status,
      paidAt: status === "success" ? new Date() : null,
      verifiedAt: new Date(),
      providerRef: providerRef ?? `${payment.provider}_verified_${Date.now()}`,
    },
  });

  if (status === "success") {
    let planName = "pro";
    let billingCycle = "monthly";
    try {
      const meta = JSON.parse(payment.metadata || "{}");
      planName = meta.planName || "pro";
      billingCycle = meta.billingCycle || "monthly";
    } catch {
      /* use defaults */
    }

    const plan = await db.subscriptionPlan.findUnique({ where: { name: planName } });
    const monthlyFee = plan?.priceUsd || 0;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + (billingCycle === "annual" ? 12 : 1));

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

    await db.business.update({
      where: { id: user.businessId },
      data: { plan: planName },
    });

    await db.payment.update({
      where: { id: payment.id },
      data: { subscriptionId: subscription.id },
    });

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
      title: "Payment successful!",
      message: `Your ${planName} plan is now active. Invoice ${invoiceNumber} generated.`,
      data: { paymentId: payment.id, invoiceId: invoice.id, planName },
    });

    return NextResponse.json({
      payment: updated,
      subscription,
      invoice: { id: invoice.id, invoiceNumber, amount: invoice.amount },
      message: "Payment verified successfully. Subscription activated.",
    });
  }

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
