import { describe, expect, it } from "vitest";
import {
  planRank,
  resolveModuleFromApiPath,
  isModuleExemptApiPath,
  formatPlanLabel,
} from "@/lib/module-registry";
import {
  calculateCheckoutAmount,
  getPaymentCurrency,
  toMinorUnits,
} from "@/lib/payment-gateway-utils";
import {
  isBillingExempt,
  isEnforcedApiPath,
} from "@/lib/subscription-access-rules";

describe("module-registry", () => {
  it("ranks plans correctly", () => {
    expect(planRank("free")).toBeLessThan(planRank("starter"));
    expect(planRank("pro")).toBeLessThan(planRank("enterprise"));
    expect(planRank("pro")).toBeLessThan(planRank("enterprise"));
    expect(planRank("enterprise")).toBeGreaterThanOrEqual(planRank("enterprise"));
  });

  it("maps API paths to modules", () => {
    expect(resolveModuleFromApiPath("/api/leads/stats")).toBe("leads");
    expect(resolveModuleFromApiPath("/api/quotes/generate")).toBe("quotes");
    expect(resolveModuleFromApiPath("/api/auth/login")).toBeNull();
  });

  it("exempts billing and auth paths", () => {
    expect(isModuleExemptApiPath("/api/payments/initialize")).toBe(true);
    expect(isModuleExemptApiPath("/api/leads")).toBe(false);
  });

  it("formats plan labels", () => {
    expect(formatPlanLabel("pro")).toBe("Pro");
  });
});

describe("payment-gateway", () => {
  it("defaults currency to NGN", () => {
    expect(getPaymentCurrency()).toBe("NGN");
  });

  it("calculates monthly checkout amount with NGN conversion", () => {
    process.env.PAYMENT_CURRENCY = "NGN";
    process.env.PAYMENT_USD_NGN_RATE = "1000";
    const { amount, currency } = calculateCheckoutAmount(79, "monthly");
    expect(currency).toBe("NGN");
    expect(amount).toBe(79000);
  });

  it("applies annual discount", () => {
    process.env.PAYMENT_CURRENCY = "USD";
    const monthly = calculateCheckoutAmount(100, "monthly");
    const annual = calculateCheckoutAmount(100, "annual");
    expect(annual.amount).toBe(960);
    expect(monthly.amount).toBe(100);
  });

  it("converts to minor units", () => {
    expect(toMinorUnits(79.5, "NGN")).toBe(7950);
    expect(toMinorUnits(10, "USD")).toBe(1000);
  });
});

describe("subscription-access-rules", () => {
  it("enforces tenant API paths only", () => {
    expect(isEnforcedApiPath("/api/leads")).toBe(true);
    expect(isEnforcedApiPath("/api/super-admin/stats")).toBe(false);
    expect(isEnforcedApiPath("/api/public/chat")).toBe(false);
  });

  it("exempts billing routes when past due", () => {
    expect(isBillingExempt("/api/payments/verify")).toBe(true);
    expect(isBillingExempt("/api/subscription")).toBe(true);
    expect(isBillingExempt("/api/leads")).toBe(false);
  });
});

describe("rate-limit", () => {
  it("allows requests within limit (memory backend)", async () => {
    const { rateLimit, _resetRateLimitStoreForTests } = await import(
      "@/lib/rate-limit"
    );
    _resetRateLimitStoreForTests();
    delete process.env.REDIS_URL;

    const first = await rateLimit("test-key", 3, 60_000);
    expect(first.success).toBe(true);
    expect(first.backend).toBe("memory");

    const second = await rateLimit("test-key", 3, 60_000);
    expect(second.success).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it("blocks when limit exceeded", async () => {
    const { rateLimit, _resetRateLimitStoreForTests } = await import(
      "@/lib/rate-limit"
    );
    _resetRateLimitStoreForTests();
    delete process.env.REDIS_URL;

    await rateLimit("block-key", 2, 60_000);
    await rateLimit("block-key", 2, 60_000);
    const blocked = await rateLimit("block-key", 2, 60_000);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
