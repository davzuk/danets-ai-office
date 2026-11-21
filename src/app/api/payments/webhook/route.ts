import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  detectPaymentProvider,
  verifyFlutterwaveWebhook,
  verifyPaystackWebhook,
} from "@/lib/payment-webhook";
import { activateSubscriptionFromPayment } from "@/lib/subscription-billing";

// POST /api/payments/webhook — verified webhook handler for Paystack / Flutterwave
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!rawBody) {
    return NextResponse.json({ error: "Empty payload" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = detectPaymentProvider({
    headers: req.headers,
    body,
  });

  if (provider === "paystack") {
    const sig = req.headers.get("x-paystack-signature");
    if (!verifyPaystackWebhook(rawBody, sig)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    return handlePaystackWebhook(body);
  }

  if (provider === "flutterwave") {
    const hash = req.headers.get("verif-hash");
    if (!verifyFlutterwaveWebhook(hash)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    return handleFlutterwaveWebhook(body);
  }

  return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
}

async function handlePaystackWebhook(body: Record<string, unknown>) {
  const event = body.event as string | undefined;
  const data = body.data as Record<string, unknown> | undefined;
  const reference = data?.reference as string | undefined;

  if (!reference) {
    return NextResponse.json({ error: "No reference" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({ where: { reference } });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (event === "charge.success") {
    // Atomic claim: only one webhook delivery wins. Concurrent retries
    // observe count=0 and skip the activate path, which would otherwise
    // race and double-bill or duplicate invoice rows.
    const claimed = await db.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: { status: "processing", verifiedAt: new Date() },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ status: "already_processed" });
    }
    await activateSubscriptionFromPayment(payment.id);
  } else if (event === "charge.failed") {
    await db.payment.updateMany({
      where: { id: payment.id, status: { in: ["pending", "processing"] } },
      data: { status: "failed", verifiedAt: new Date() },
    });
  }

  return NextResponse.json({ status: "success" });
}

async function handleFlutterwaveWebhook(body: Record<string, unknown>) {
  const event = body.event as string | undefined;
  const data = body.data as Record<string, unknown> | undefined;
  const txRef = data?.tx_ref as string | undefined;

  if (!txRef) {
    return NextResponse.json({ error: "No tx_ref" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({ where: { reference: txRef } });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (event === "charge.completed" && data?.status === "successful") {
    const claimed = await db.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: { status: "processing", verifiedAt: new Date() },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ status: "already_processed" });
    }
    await activateSubscriptionFromPayment(payment.id);
  }

  return NextResponse.json({ status: "success" });
}
