import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { requireReauth } from "@/lib/reauth";
import { logActivity } from "@/lib/activity";
import { getQuotaUsage, getEffectiveLimits } from "@/lib/plan-quota";
import { applyPlanTransition, validatePlanTransition } from "@/lib/plan-transitions";

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

    // Use the shared quota helpers so /api/subscription stays in sync with
    // every other gate. Effective limits honor the BusinessLimitOverride.
    const [usage, limits] = await Promise.all([
      getQuotaUsage(user.businessId),
      getEffectiveLimits(user.businessId, subscription.planName),
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
        downgradeScheduledFor: subscription.downgradeScheduledFor?.toISOString() || null,
        downgradeTargetPlan: subscription.downgradeTargetPlan ?? null,
      },
      plan: plan
        ? {
            name: plan.name,
            priceUsd: plan.priceUsd,
            chatLimit: plan.chatLimit,
            leadLimit: plan.leadLimit,
            kbLimit: plan.kbLimit,
            ticketLimit: plan.ticketLimit,
            documentLimit: plan.documentLimit,
            automationLimit: plan.automationLimit,
            seatLimit: plan.seatLimit,
            whatsappTemplateLimit: plan.whatsappTemplateLimit,
            integrationLimit: plan.integrationLimit,
            proposalTemplateLimit: plan.proposalTemplateLimit,
            quoteLimit: plan.quoteLimit,
            bookingTypeLimit: plan.bookingTypeLimit,
            pageLimit: plan.pageLimit,
            features: JSON.parse(plan.features || "[]"),
          }
        : null,
      limits,
      usage,
      allPlans: (await db.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { priceUsd: "asc" },
      })).map((p) => ({
        name: p.name,
        priceUsd: p.priceUsd,
        chatLimit: p.chatLimit,
        leadLimit: p.leadLimit,
        kbLimit: p.kbLimit,
        ticketLimit: p.ticketLimit,
        documentLimit: p.documentLimit,
        automationLimit: p.automationLimit,
        seatLimit: p.seatLimit,
        whatsappTemplateLimit: p.whatsappTemplateLimit,
        integrationLimit: p.integrationLimit,
        proposalTemplateLimit: p.proposalTemplateLimit,
        quoteLimit: p.quoteLimit,
        bookingTypeLimit: p.bookingTypeLimit,
        pageLimit: p.pageLimit,
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
    // Plan transitions are high-blast-radius: a downgrade triggers
    // quota reaping and lost revenue, an upgrade changes billing. The
    // audit requires a fresh credential for any state change that
    // crosses a trust boundary — we honour that here.
    await requireReauth({ userId: user.userId, sessionId: user.sessionId ?? "" });

    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid input");
    }

    // Resolve the current plan so we can rank-compare against the target.
    const business = await db.business.findUnique({
      where: { id: user.businessId },
      select: { plan: true },
    });
    const fromPlan = business?.plan || "free";

    // Validate the transition before opening a transaction. Downgrades that
    // would push the tenant over a new plan's limits are rejected with 409
    // and a `conflicts` payload the UI can surface directly.
    const validation = await validatePlanTransition(
      user.businessId,
      parsed.data.planName,
      fromPlan
    );
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.reason,
          conflicts: validation.conflicts,
        },
        { status: 409 }
      );
    }

    const plan = await db.subscriptionPlan.findUnique({
      where: { name: parsed.data.planName },
    });
    if (!plan) throw new Error("Plan not found");

    const applied = await applyPlanTransition(user.businessId, fromPlan, parsed.data.planName, {
      userId: user.userId,
      name: user.name,
    });
    if (!applied.ok) {
      return NextResponse.json({ error: applied.reason }, { status: 400 });
    }

    // Optional payment metadata — for upgrades paid via the payment gateway.
    if (parsed.data.paymentMethod || parsed.data.paymentRef !== undefined) {
      const paymentData: any = {};
      if (parsed.data.paymentMethod) paymentData.paymentMethod = parsed.data.paymentMethod;
      if (parsed.data.paymentRef !== undefined) {
        paymentData.paymentRef = parsed.data.paymentRef || null;
      }
      await db.businessSubscription.update({
        where: { id: applied.subscription.id },
        data: paymentData,
      });
    }

    await logActivity({
      businessId: user.businessId,
      userId: user.userId,
      userName: user.name,
      action: applied.scheduled
        ? "subscription_downgrade_scheduled"
        : "subscription_changed",
      module: "subscription",
      description: applied.scheduled
        ? `Scheduled downgrade from ${fromPlan} to ${parsed.data.planName} (effective ${applied.effectiveAt})`
        : `Changed subscription to ${parsed.data.planName} plan ($${plan.priceUsd}/mo)`,
      metadata: {
        fromPlan,
        toPlan: parsed.data.planName,
        monthlyFee: plan.priceUsd,
        scheduled: applied.scheduled,
        effectiveAt: applied.effectiveAt,
      },
    });

    // Re-read the subscription so the response includes the new fields.
    const refreshed = await db.businessSubscription.findUnique({
      where: { id: applied.subscription.id },
    });

    return {
      subscription: {
        ...refreshed,
        downgradeScheduledFor: refreshed?.downgradeScheduledFor?.toISOString() ?? null,
        downgradeTargetPlan: refreshed?.downgradeTargetPlan ?? null,
        startDate: refreshed?.startDate?.toISOString(),
        endDate: refreshed?.endDate?.toISOString() ?? null,
        trialEndsAt: refreshed?.trialEndsAt?.toISOString() ?? null,
        createdAt: refreshed?.createdAt?.toISOString(),
        updatedAt: refreshed?.updatedAt?.toISOString(),
      },
      scheduled: applied.scheduled,
      effectiveAt: applied.effectiveAt,
    };
  });
}
