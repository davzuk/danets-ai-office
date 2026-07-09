export function getPaymentCurrency(): string {
  return (process.env.PAYMENT_CURRENCY || "NGN").toUpperCase();
}

export function calculateCheckoutAmount(
  priceUsd: number,
  billingCycle: "monthly" | "annual"
): { amount: number; currency: string } {
  const currency = getPaymentCurrency();
  const monthlyUsd = priceUsd;
  const totalUsd =
    billingCycle === "annual" ? monthlyUsd * 12 * 0.8 : monthlyUsd;

  if (currency === "USD") {
    return { amount: roundMoney(totalUsd), currency: "USD" };
  }

  const rate = parseFloat(process.env.PAYMENT_USD_NGN_RATE || "1600") || 1600;
  return { amount: roundMoney(totalUsd * rate), currency: "NGN" };
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export function toMinorUnits(amount: number, currency: string): number {
  const zeroDecimal = new Set(["JPY", "KRW"]);
  if (zeroDecimal.has(currency.toUpperCase())) return Math.round(amount);
  return Math.round(amount * 100);
}

export function mockCheckoutUrl(
  reference: string,
  amount: number,
  currency: string,
  email: string,
  provider: string
): string {
  const params = new URLSearchParams({
    ref: reference,
    amount: amount.toString(),
    currency,
    email,
    provider,
  });
  return `/payment-checkout?${params.toString()}`;
}
