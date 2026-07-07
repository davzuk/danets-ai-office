import { createHmac, timingSafeEqual } from "crypto";

export function verifyPaystackWebhook(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    // Dev mode: allow unsigned webhooks when secret not configured
    return process.env.NODE_ENV !== "production";
  }
  if (!signature) return false;

  const hash = createHmac("sha512", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

export function verifyFlutterwaveWebhook(verifHash: string | null): boolean {
  const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!secretHash) {
    return process.env.NODE_ENV !== "production";
  }
  if (!verifHash) return false;

  try {
    return timingSafeEqual(Buffer.from(verifHash, "utf8"), Buffer.from(secretHash, "utf8"));
  } catch {
    return false;
  }
}

export function detectPaymentProvider(req: {
  headers: { get(name: string): string | null };
  body: Record<string, unknown>;
}): "paystack" | "flutterwave" | "unknown" {
  if (req.headers.get("x-paystack-signature")) return "paystack";
  if (req.headers.get("verif-hash")) return "flutterwave";
  const provider = req.body?.provider;
  if (provider === "paystack" || provider === "flutterwave") return provider;
  return "unknown";
}
