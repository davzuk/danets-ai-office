import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { requireReauth } from "@/lib/reauth";
import { logActivity, createNotification } from "@/lib/activity";
import {
  verifyFlutterwaveTransaction,
  verifyPaystackTransaction,
} from "@/lib/payment-gateway";
import { createInvoiceForPayment } from "@/lib/invoice";

const verifySchema = z.object({
  reference: z.string().min(1),
});

// POST /api/payments/verify — verify/confirm a payment (client callback or manual)
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Success path upgrades the subscription to a paid plan. The audit
  // requires a fresh credential for any state change that crosses a trust
  // boundary; gate verify behind reauth so a stolen session cookie
  // can't silently activate a paid plan after the payment row was
  // already created.
  try {
    await requireReauth({ userId: user.userId, sessionId: user.sessionId ?? "" });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Reauthentication required", code: "REAUTH_REQUIRED" },
      { status: e?.status || 401 }
    );
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

  let status: "success" | "failed";
  let providerRef: string | undefined;

  if (payment.provider === "paystack") {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        { error: "Payment provider not configured" },
        { status: 503 }
      );
    }
    const verified = await verifyPaystackTransaction(reference);
    status = verified.success ? "success" : "failed";
    providerRef = verified.providerRef;
  } else if (payment.provider === "flutterwave") {
    if (!process.env.FLUTTERWAVE_SECRET_KEY) {
      return NextResponse.json(
        { error: "Payment provider not configured" },
        { status: 503 }
      );
    }
    const verified = await verifyFlutterwaveTransaction(reference);
    status = verified.success ? "success" : "failed";
    providerRef = verified.providerRef;
  } else {
    // Unknown provider — refuse rather than default to success.
    return NextResponse.json(
      { error: "Unknown payment provider" },
      { status: 400 }
    );
  }

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

    // Activate the subscription + invoice + activity log atomically so a
    // mid-flight failure can't leave a paid customer without an active
    // plan or a duplicate invoice row.
    const { updatedPayment, subscription, invoice, invoiceNumber } =
      await db.$transaction(async (tx) => {
        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "success",
            paidAt: new Date(),
            verifiedAt: new Date(),
            providerRef: providerRef ?? `${payment.provider}_verified_${Date.now()}`,
          },
        });

        let sub = await tx.businessSubscription.findUnique({
          where: { businessId: user.businessId },
        });
        if (sub) {
          sub = await tx.businessSubscription.update({
            where: { id: sub.id },
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
          sub = await tx.businessSubscription.create({
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

        await tx.business.update({
          where: { id: user.businessId },
          data: { plan: planName },
        });

        await tx.payment.update({
          where: { id: payment.id },
          data: { subscriptionId: sub.id },
        });

        // Idempotent invoice creation shared with `activateSubscriptionFromPayment`
        // — re-submitted verify calls won't create a duplicate row.
        const inv = await createInvoiceForPayment(tx, {
          businessId: user.businessId,
          subscriptionId: sub.id,
          paymentId: payment.id,
          planName,
          billingCycle,
          amount: payment.amount,
          currency: payment.currency,
          provider: payment.provider,
          reference,
        });

        return {
          updatedPayment: updated,
          subscription: sub,
          invoice: inv,
          invoiceNumber: inv.invoiceNumber,
        };
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
      payment: updatedPayment,
      subscription,
      invoice: { id: invoice.id, invoiceNumber, amount: invoice.amount },
      message: "Payment verified successfully. Subscription activated.",
    });
  }

  // status === "failed"
  const updated = await db.payment.update({
    where: { id: payment.id },
    data: {
      status: "failed",
      paidAt: null,
      verifiedAt: new Date(),
      providerRef: providerRef ?? `${payment.provider}_verified_${Date.now()}`,
    },
  });

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
