import "server-only";
import {
  calculateCheckoutAmount,
  getPaymentCurrency,
  mockCheckoutUrl,
  toMinorUnits,
} from "@/lib/payment-gateway-utils";

export {
  calculateCheckoutAmount,
  getPaymentCurrency,
  isTestCheckoutAllowed,
  mockCheckoutUrl,
  toMinorUnits,
} from "@/lib/payment-gateway-utils";

export type PaymentProvider = "paystack" | "flutterwave";

export interface CheckoutInitResult {
  paymentUrl: string;
  providerRef?: string;
  mode: "live" | "sandbox";
}

function appBaseUrl(override?: string): string {
  return (
    override ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function isPaystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

export function isFlutterwaveConfigured(): boolean {
  return !!process.env.FLUTTERWAVE_SECRET_KEY;
}

export async function initializePaystackCheckout(opts: {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  baseUrl?: string;
}): Promise<CheckoutInitResult> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    throw new Error("PAYSTACK_NOT_CONFIGURED");
  }

  const callbackUrl = `${appBaseUrl(opts.baseUrl)}/?payment=success&ref=${encodeURIComponent(opts.reference)}`;

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: opts.email,
      amount: toMinorUnits(opts.amount, opts.currency),
      currency: opts.currency,
      reference: opts.reference,
      callback_url: callbackUrl,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.data?.authorization_url) {
    throw new Error(data?.message || `Paystack init failed (${res.status})`);
  }

  return {
    paymentUrl: data.data.authorization_url as string,
    providerRef: data.data.access_code as string | undefined,
    mode: secret.startsWith("sk_test") ? "sandbox" : "live",
  };
}

export async function initializeFlutterwaveCheckout(opts: {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  customerName?: string;
  baseUrl?: string;
}): Promise<CheckoutInitResult> {
  const secret = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secret) {
    throw new Error("FLUTTERWAVE_NOT_CONFIGURED");
  }

  const redirectUrl = `${appBaseUrl(opts.baseUrl)}/?payment=success&ref=${encodeURIComponent(opts.reference)}`;

  const res = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tx_ref: opts.reference,
      amount: opts.amount,
      currency: opts.currency,
      redirect_url: redirectUrl,
      customer: {
        email: opts.email,
        name: opts.customerName || opts.email,
      },
      customizations: {
        title: "Danets AI Automation",
        description: "Subscription payment",
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status !== "success" || !data?.data?.link) {
    throw new Error(data?.message || `Flutterwave init failed (${res.status})`);
  }

  return {
    paymentUrl: data.data.link as string,
    mode: secret.includes("TEST") ? "sandbox" : "live",
  };
}

export type ProviderVerifyResult = {
  success: boolean;
  providerRef?: string;
  message?: string;
};

export async function verifyPaystackTransaction(
  reference: string
): Promise<ProviderVerifyResult> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return { success: false, message: "Paystack not configured" };
  }

  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } }
  );
  const data = await res.json().catch(() => ({}));
  const tx = data?.data;

  if (!res.ok || data?.status !== true) {
    return { success: false, message: data?.message || "Verification failed" };
  }

  return {
    success: tx?.status === "success",
    providerRef: String(tx?.id ?? ""),
    message: tx?.gateway_response,
  };
}

export async function verifyFlutterwaveTransaction(
  reference: string
): Promise<ProviderVerifyResult> {
  const secret = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secret) {
    return { success: false, message: "Flutterwave not configured" };
  }

  const res = await fetch(
    `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } }
  );
  const data = await res.json().catch(() => ({}));
  const tx = data?.data;

  if (!res.ok || data?.status !== "success") {
    return { success: false, message: data?.message || "Verification failed" };
  }

  return {
    success: tx?.status === "successful",
    providerRef: String(tx?.id ?? ""),
    message: tx?.processor_response,
  };
}
