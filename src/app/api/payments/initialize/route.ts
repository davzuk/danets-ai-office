import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { randomBytes } from "crypto";
import {
  calculateCheckoutAmount,
  initializeFlutterwaveCheckout,
  initializePaystackCheckout,
  isFlutterwaveConfigured,
  isPaystackConfigured,
  mockCheckoutUrl,
} from "@/lib/payment-gateway";

const initSchema = z.object({
  planName: z.enum(["free", "starter", "pro", "enterprise"]),
  provider: z.enum(["paystack", "flutterwave", "bank_transfer", "manual"]),
  billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
});

// POST /api/payments/initialize — initialize a payment for a plan upgrade
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = initSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { planName, provider, billingCycle } = parsed.data;

  const plan = await db.subscriptionPlan.findUnique({ where: { name: planName } });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const { amount, currency } = calculateCheckoutAmount(plan.priceUsd, billingCycle);

  if (amount === 0) {
    return handleFreePlan(user, planName);
  }

  const reference = `DAN-${Date.now()}-${randomBytes(4).toString("hex")}`;

  const payment = await db.payment.create({
    data: {
      businessId: user.businessId,
      amount,
      currency,
      provider,
      reference,
      status: "pending",
      payerEmail: user.email,
      payerName: user.name,
      metadata: JSON.stringify({
        planName,
        billingCycle,
        monthlyFee: plan.priceUsd,
      }),
    },
  });

  await logActivity({
    businessId: user.businessId,
    userId: user.userId,
    userName: user.name,
    action: "subscription_changed",
    module: "subscription",
    description: `Initialized ${provider} payment of ${currency} ${amount} for ${planName} plan (${billingCycle})`,
    metadata: { paymentId: payment.id, reference, planName, amount },
  });

  const baseUrl = req.nextUrl.origin;
  let paymentUrl: string;
  let checkoutMode: "live" | "sandbox" | "mock" = "mock";
  let note: string;

  try {
    if (provider === "paystack") {
      if (!isPaystackConfigured()) {
        paymentUrl = mockCheckoutUrl(reference, amount, currency, user.email, provider);
        note =
          "Paystack keys not configured — using local test checkout. Set PAYSTACK_SECRET_KEY for live checkout.";
      } else {
        const checkout = await initializePaystackCheckout({
          email: user.email,
          amount,
          currency,
          reference,
          baseUrl,
        });
        paymentUrl = checkout.paymentUrl;
        checkoutMode = checkout.mode;
        note = "Redirecting to Paystack secure checkout.";
      }
    } else if (provider === "flutterwave") {
      if (!isFlutterwaveConfigured()) {
        paymentUrl = mockCheckoutUrl(reference, amount, currency, user.email, provider);
        note =
          "Flutterwave keys not configured — using local test checkout. Set FLUTTERWAVE_SECRET_KEY for live checkout.";
      } else {
        const checkout = await initializeFlutterwaveCheckout({
          email: user.email,
          amount,
          currency,
          reference,
          customerName: user.name,
          baseUrl,
        });
        paymentUrl = checkout.paymentUrl;
        checkoutMode = checkout.mode;
        note = "Redirecting to Flutterwave secure checkout.";
      }
    } else {
      paymentUrl = mockCheckoutUrl(reference, amount, currency, user.email, provider);
      note = "Manual payment — use the reference to confirm after transfer.";
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Checkout initialization failed";
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "failed" },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({
    payment: {
      id: payment.id,
      reference,
      amount,
      currency,
      provider,
      status: "pending",
      planName,
      billingCycle,
    },
    paymentUrl,
    checkoutMode,
    note,
  });
}

async function handleFreePlan(user: { businessId: string }, planName: string) {
  let subscription = await db.businessSubscription.findUnique({
    where: { businessId: user.businessId },
  });

  if (subscription) {
    subscription = await db.businessSubscription.update({
      where: { id: subscription.id },
      data: { planName, status: "active", monthlyFee: 0 },
    });
  } else {
    subscription = await db.businessSubscription.create({
      data: { businessId: user.businessId, planName, status: "active", monthlyFee: 0 },
    });
  }

  await db.business.update({
    where: { id: user.businessId },
    data: { plan: planName },
  });

  return NextResponse.json({
    payment: null,
    redirected: true,
    message: "Switched to free plan — no payment required.",
  });
}
