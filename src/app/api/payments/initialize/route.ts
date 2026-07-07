import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { randomBytes } from "crypto";

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

  // Get plan details
  const plan = await db.subscriptionPlan.findUnique({ where: { name: planName } });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Calculate amount (annual = 20% discount)
  const monthlyFee = plan.priceUsd;
  const amount = billingCycle === "annual" ? monthlyFee * 12 * 0.8 : monthlyFee;
  const currency = "USD";

  if (amount === 0) {
    // Free plan — no payment needed, just update subscription
    return handleFreePlan(user, planName);
  }

  // Generate unique reference
  const reference = `DAN-${Date.now()}-${randomBytes(4).toString("hex")}`;

  // Create payment record
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
      metadata: JSON.stringify({ planName, billingCycle, monthlyFee }),
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

  // Generate provider-specific payment URL
  // In production, this would call the actual Paystack/Flutterwave API
  // For now, return a mock URL that simulates the payment page
  const paymentUrl = generatePaymentUrl(provider, reference, amount, currency, user.email);

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
    note:
      provider === "manual" || provider === "bank_transfer"
        ? "Manual payment — use the reference to confirm after transfer."
        : "Payment gateway integration is ready. In production, this URL redirects to the provider's checkout page.",
  });
}

async function handleFreePlan(
  user: any,
  planName: string
) {
  // Update subscription directly
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

function generatePaymentUrl(
  provider: string,
  reference: string,
  amount: number,
  currency: string,
  email: string
): string {
  // In production, these would be real API calls:
  // - Paystack: POST https://api.paystack.co/transaction/initialize
  // - Flutterwave: POST https://api.flutterwave.com/v3/payments

  // For now, return a mock checkout URL
  const params = new URLSearchParams({
    ref: reference,
    amount: amount.toString(),
    currency,
    email,
    provider,
  });
  return `/payment-checkout?${params.toString()}`;
}
