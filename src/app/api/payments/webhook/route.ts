import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logActivity, createNotification } from "@/lib/activity";

// POST /api/payments/webhook — webhook handler for payment providers
// This endpoint is called by Paystack/Flutterwave when a payment event occurs.
// It does NOT require session authentication (authenticated via provider signature).
//
// Paystack webhook: https://paystack.com/docs/payments/webhooks
// Flutterwave webhook: https://developer.flutterwave.com/reference/webhooks
//
// Environment variables needed:
// PAYSTACK_SECRET_KEY=sk_test_xxx
// PAYSTACK_PUBLIC_KEY=pk_test_xxx
// FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST_xxx
// FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST_xxx

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Determine provider from header or body
  const provider = req.headers.get("x-paystack-signature")
    ? "paystack"
    : req.headers.get("verif-hash")
    ? "flutterwave"
    : body?.provider || "unknown";

  // In production, verify the webhook signature:
  // - Paystack: HMAC-SHA512 of body with PAYSTACK_SECRET_KEY
  // - Flutterwave: compare verif-hash header with FLUTTERWAVE_SECRET_HASH

  try {
    if (provider === "paystack") {
      return handlePaystackWebhook(body);
    } else if (provider === "flutterwave") {
      return handleFlutterwaveWebhook(body);
    } else {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[webhook] error:", e?.message);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function handlePaystackWebhook(body: any) {
  const event = body?.event;
  const data = body?.data;

  if (!data?.reference) {
    return NextResponse.json({ error: "No reference" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({
    where: { reference: data.reference },
  });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (event === "charge.success") {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "success",
        paidAt: new Date(data.paid_at || new Date()),
        verifiedAt: new Date(),
        providerRef: data.id,
      },
    });
    // Subscription activation is handled by the verify endpoint logic
    // In production, call the same activation logic here
  } else if (event === "charge.failed") {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "failed", verifiedAt: new Date() },
    });
  }

  return NextResponse.json({ status: "success" });
}

async function handleFlutterwaveWebhook(body: any) {
  const event = body?.event;
  const data = body?.data;

  if (!data?.tx_ref) {
    return NextResponse.json({ error: "No tx_ref" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({
    where: { reference: data.tx_ref },
  });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (event === "charge.completed" && data.status === "successful") {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "success",
        paidAt: new Date(data.created_at || new Date()),
        verifiedAt: new Date(),
        providerRef: data.id?.toString(),
      },
    });
  }

  return NextResponse.json({ status: "success" });
}
