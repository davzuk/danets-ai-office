import { db } from "@/lib/db";
import { randomBytes } from "crypto";

export async function activateSubscriptionFromPayment(
  paymentId: string,
  opts?: { billingCycle?: "monthly" | "annual"; actorName?: string }
) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new Error("Payment not found");
  if (payment.status === "success") throw new Error("Payment already processed");

  let planName = "pro";
  let billingCycle: "monthly" | "annual" = opts?.billingCycle || "monthly";
  try {
    const meta = JSON.parse(payment.metadata || "{}");
    planName = meta.planName || planName;
    billingCycle = meta.billingCycle || billingCycle;
  } catch {
    /* use defaults */
  }

  const plan = await db.subscriptionPlan.findUnique({ where: { name: planName } });
  const monthlyFee = plan?.priceUsd ?? payment.amount;

  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + (billingCycle === "annual" ? 12 : 1));

  const result = await db.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "success",
        paidAt: new Date(),
        verifiedAt: new Date(),
        providerRef: payment.providerRef || `manual_${Date.now()}`,
      },
    });

    const existingSub = await tx.businessSubscription.findUnique({
      where: { businessId: payment.businessId },
    });

    const subscription = existingSub
      ? await tx.businessSubscription.update({
          where: { id: existingSub.id },
          data: {
            planName,
            status: "active",
            monthlyFee,
            endDate,
            paymentMethod: payment.provider,
            paymentRef: payment.reference,
          },
        })
      : await tx.businessSubscription.create({
          data: {
            businessId: payment.businessId,
            planName,
            status: "active",
            monthlyFee,
            endDate,
            paymentMethod: payment.provider,
            paymentRef: payment.reference,
          },
        });

    await tx.business.update({
      where: { id: payment.businessId },
      data: { plan: planName, status: "active" },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { subscriptionId: subscription.id },
    });

    const existingInvoice = await tx.invoice.findFirst({
      where: { paymentId: payment.id },
    });

    let invoice = existingInvoice;
    if (!invoice) {
      const invoiceNumber = `INV-${Date.now()}-${randomBytes(2).toString("hex").toUpperCase()}`;
      invoice = await tx.invoice.create({
        data: {
          businessId: payment.businessId,
          subscriptionId: subscription.id,
          paymentId: payment.id,
          invoiceNumber,
          amount: payment.amount,
          currency: payment.currency,
          status: "paid",
          paidAt: new Date(),
          dueDate: new Date(),
          items: JSON.stringify([
            {
              description: `${planName} plan (${billingCycle})`,
              quantity: 1,
              unitPrice: payment.amount,
              total: payment.amount,
            },
          ]),
          notes: `Payment via ${payment.provider}. Reference: ${payment.reference}`,
        },
      });
    }

    return { payment: updatedPayment, subscription, invoice };
  });

  return result;
}

export function generateInvoiceNumber() {
  return `INV-${Date.now()}-${randomBytes(2).toString("hex").toUpperCase()}`;
}
