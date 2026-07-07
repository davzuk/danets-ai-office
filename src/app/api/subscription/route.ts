import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { logActivity } from "@/lib/activity";

// GET /api/subscription — get business subscription + plan details + usage
export function GET(_req: NextRequest) {
  return withSession(async (user) => {
    // Get or create subscription record
    let subscription = await db.businessSubscription.findUnique({
      where: { businessId: user.businessId },
    });

    if (!subscription) {
      // Default to the business's current plan
      const business = await db.business.findUnique({
        where: { id: user.businessId },
        select: { plan: true },
      });
      subscription = await db.businessSubscription.create({
        data: {
          businessId: user.businessId,
          planName: business?.plan || "free",
          status: "active",
          monthlyFee: 0,
        },
      });
    }

    // Get plan details
    const plan = await db.subscriptionPlan.findUnique({
      where: { name: subscription.planName },
    });

    // Get current usage
    const [chatCount, leadCount, kbCount, aiRequests] = await Promise.all([
      db.chatSession.count({
        where: {
          businessId: user.businessId,
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      db.lead.count({
        where: {
          businessId: user.businessId,
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      db.knowledgeBaseItem.count({ where: { businessId: user.businessId } }),
      db.aiUsageLog.count({
        where: {
          businessId: user.businessId,
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ]);

    return {
      subscription: {
        id: subscription.id,
        planName: subscription.planName,
        status: subscription.status,
        startDate: subscription.startDate.toISOString(),
        endDate: subscription.endDate?.toISOString() || null,
        trialEndsAt: subscription.trialEndsAt?.toISOString() || null,
        monthlyFee: subscription.monthlyFee,
        paymentMethod: subscription.paymentMethod,
      },
      plan: plan
        ? {
            name: plan.name,
            priceUsd: plan.priceUsd,
            chatLimit: plan.chatLimit,
            leadLimit: plan.leadLimit,
            kbLimit: plan.kbLimit,
            features: JSON.parse(plan.features || "[]"),
          }
        : null,
      usage: {
        chats: chatCount,
        leads: leadCount,
        kbItems: kbCount,
        aiRequests,
      },
      allPlans: (await db.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { priceUsd: "asc" },
      })).map((p) => ({
        name: p.name,
        priceUsd: p.priceUsd,
        chatLimit: p.chatLimit,
        leadLimit: p.leadLimit,
        kbLimit: p.kbLimit,
        features: JSON.parse(p.features || "[]"),
      })),
    };
  });
}

const updateSchema = z.object({
  planName: z.enum(["free", "starter", "business", "premium", "enterprise"]),
  paymentMethod: z.enum(["paystack", "flutterwave", "bank_transfer", "manual"]).optional(),
  paymentRef: z.string().max(200).optional().nullable(),
  status: z.enum(["active", "trial", "past_due", "canceled", "expired"]).optional(),
});

// PUT /api/subscription — update subscription (change plan, record payment)
export function PUT(req: NextRequest) {
  return withSession(async (user) => {
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    const plan = await db.subscriptionPlan.findUnique({
      where: { name: parsed.data.planName },
    });
    if (!plan) throw new Error("Plan not found");

    const data: any = {
      planName: parsed.data.planName,
      monthlyFee: plan.priceUsd,
    };
    if (parsed.data.paymentMethod) data.paymentMethod = parsed.data.paymentMethod;
    if (parsed.data.paymentRef !== undefined) data.paymentRef = parsed.data.paymentRef || null;
    if (parsed.data.status) data.status = parsed.data.status;

    // Sync Business.plan and BusinessSubscription in one transaction so
    // the two cannot drift apart.
    const subscription = await db.$transaction(async (tx) => {
      const existing = await tx.businessSubscription.findUnique({
        where: { businessId: user.businessId },
      });
      const result = existing
        ? await tx.businessSubscription.update({ where: { id: existing.id }, data })
        : await tx.businessSubscription.create({
            data: { businessId: user.businessId, ...data },
          });

      await tx.business.update({
        where: { id: user.businessId },
        data: { plan: parsed.data.planName },
      });

      return result;
    });

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: "subscription_changed",
      module: "subscription",
      description: `Changed subscription to ${parsed.data.planName} plan ($${plan.priceUsd}/mo)`,
      metadata: { planName: parsed.data.planName, monthlyFee: plan.priceUsd },
    });

    return { subscription };
  });
}
