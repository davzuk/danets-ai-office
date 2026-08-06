import { db } from "@/lib/db";
import { createInvoiceForPayment } from "@/lib/invoice";

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

    const invoice = await createInvoiceForPayment(tx, {
      businessId: payment.businessId,
      subscriptionId: subscription.id,
      paymentId: payment.id,
      planName,
      billingCycle,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      reference: payment.reference,
    });

    return { payment: updatedPayment, subscription, invoice };
  });

  return result;
}

// Re-export so existing callers (`generateInvoiceNumber()` from
// `subscription-billing.ts`) keep working without a churn migration.
export { generateInvoiceNumber } from "@/lib/invoice";
