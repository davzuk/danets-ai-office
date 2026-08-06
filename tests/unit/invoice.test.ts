import { describe, expect, it, vi } from "vitest";
import { generateInvoiceNumber } from "@/lib/invoice";

describe("generateInvoiceNumber", () => {
  it("uses the INV-<unix-ms>-<4hex> shape", () => {
    const n = generateInvoiceNumber();
    expect(n).toMatch(/^INV-\d+-[0-9A-F]{4}$/);
  });

  it("generates unique values back-to-back", () => {
    const a = generateInvoiceNumber();
    const b = generateInvoiceNumber();
    // Different timestamp OR different hex suffix — either way not strictly equal.
    expect(a === b).toBe(false);
  });
});

describe("createInvoiceForPayment idempotency", () => {
  it("returns the existing invoice instead of inserting a duplicate", async () => {
    const existing = {
      id: "inv_existing",
      invoiceNumber: "INV-1-DEAD",
      paymentId: "pay_123",
      businessId: "biz_1",
      subscriptionId: "sub_1",
      amount: 100,
      currency: "USD",
      status: "paid",
      paidAt: new Date(),
      dueDate: new Date(),
      items: "[]",
      notes: null,
    };

    const tx = {
      invoice: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    } as any;

    // Defer import so the vi.mock above registers first.
    const { createInvoiceForPayment } = await import("@/lib/invoice");
    const result = await createInvoiceForPayment(tx, {
      businessId: "biz_1",
      subscriptionId: "sub_1",
      paymentId: "pay_123",
      planName: "pro",
      billingCycle: "monthly",
      amount: 100,
      currency: "USD",
      provider: "paystack",
      reference: "ref_1",
    });

    expect(tx.invoice.findFirst).toHaveBeenCalledWith({
      where: { paymentId: "pay_123" },
    });
    expect(tx.invoice.create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it("inserts when no existing invoice matches", async () => {
    const created = {
      id: "inv_new",
      invoiceNumber: "INV-NEW",
      paymentId: "pay_new",
      businessId: "biz_2",
      subscriptionId: "sub_2",
      amount: 200,
      currency: "USD",
      status: "paid",
      paidAt: new Date(),
      dueDate: new Date(),
      items: "[]",
      notes: null,
    };

    const tx = {
      invoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
    } as any;

    const { createInvoiceForPayment } = await import("@/lib/invoice");
    const result = await createInvoiceForPayment(tx, {
      businessId: "biz_2",
      subscriptionId: "sub_2",
      paymentId: "pay_new",
      planName: "pro",
      billingCycle: "annual",
      amount: 200,
      currency: "USD",
      provider: "flutterwave",
      reference: "ref_2",
    });

    expect(tx.invoice.findFirst).toHaveBeenCalled();
    expect(tx.invoice.create).toHaveBeenCalledOnce();
    expect(result).toBe(created);
  });
});