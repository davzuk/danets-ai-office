import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { planRank } from "@/lib/module-registry";
import {
  RESOURCE_LABELS,
  getEffectiveLimits,
  getQuotaUsage,
  type QuotaResource,
} from "@/lib/plan-quota";

export type PlanTransitionResult =
  | {
      ok: true;
      /** True when a downgrade was deferred until the end of the current billing period. */
      scheduled: boolean;
      /** The target plan name that will be (or was) applied. */
      planName: string;
      /** When set, the time the downgrade takes effect. */
      effectiveAt: string | null;
    }
  | {
      ok: false;
      reason: string;
      conflicts: { resource: QuotaResource; used: number; limit: number; label: string }[];
    };

export type ApplyPlanTransitionActor = {
  userId?: string;
  name?: string;
  /** `true` when the change was made by a platform super admin. */
  isSuperAdmin?: boolean;
};

/**
 * Validate that `businessId` can move from its current plan to `targetPlan`.
 *
 * Rules:
 *  - Target plan must exist.
 *  - Downgrades are blocked when current usage exceeds the target plan's
 *    limits, returning a `conflicts` list the UI can surface directly.
 *  - Upgrades are always allowed.
 *
 * `currentPlanName` may be undefined — in that case we look it up from the
 * `Business` row.
 */
export async function validatePlanTransition(
  businessId: string,
  targetPlan: string,
  currentPlanName?: string
): Promise<PlanTransitionResult> {
  const target = await db.subscriptionPlan.findUnique({
    where: { name: targetPlan },
  });
  if (!target) {
    return { ok: false, reason: "Plan not found", conflicts: [] };
  }

  const fromPlan =
    currentPlanName ??
    (
      await db.business.findUnique({
        where: { id: businessId },
        select: { plan: true },
      })
    )?.plan ??
    "free";

  // Upgrades are always allowed — no usage check needed.
  if (planRank(targetPlan) >= planRank(fromPlan)) {
    return {
      ok: true,
      scheduled: false,
      planName: targetPlan,
      effectiveAt: null,
    };
  }

  // Downgrade: reject if usage exceeds the new plan's limits.
  const [usage, limits] = await Promise.all([
    getQuotaUsage(businessId),
    getEffectiveLimits(businessId, targetPlan),
  ]);

  const resources = Object.keys(usage) as QuotaResource[];
  const conflicts: PlanTransitionResult extends infer R
    ? R extends { ok: false; conflicts: infer C }
      ? C
      : never
    : never = [];
  type Conflict = { resource: QuotaResource; used: number; limit: number; label: string };

  const collected: Conflict[] = [];
  for (const resource of resources) {
    const used = usage[resource];
    const limit = limits[resource];
    if (used > limit) {
      collected.push({
        resource,
        used,
        limit,
        label: RESOURCE_LABELS[resource] ?? resource,
      });
    }
  }

  if (collected.length > 0) {
    return {
      ok: false,
      reason: `Cannot downgrade to ${targetPlan}: current usage exceeds the new plan's limits.`,
      conflicts: collected,
    };
  }

  return {
    ok: true,
    scheduled: true,
    planName: targetPlan,
    effectiveAt: null, // filled in by `applyPlanTransition` once we know `endDate`
  };
}

/**
 * Apply a validated plan transition inside a single transaction.
 *
 * - For upgrades (`toPlan` ranks ≥ `fromPlan`): immediately updates the
 *   subscription + business rows; clears any pending scheduled downgrade.
 * - For downgrades: keeps the current plan active until the end of the
 *   current billing period, stores `downgradeScheduledFor` +
 *   `downgradeTargetPlan` on the subscription, and updates `Business.plan`
 *   optimistically so quota reads reflect the target — callers that want
 *   strict "current limits until effectiveAt" semantics should call
 *   `getEffectiveLimits(businessId, subscription.planName)` instead of
 *   `getEffectiveLimits(businessId, business.plan)`.
 *
 * Returns the post-update subscription row + the effective date (ISO string
 * or null if the transition was immediate).
 */
export async function applyPlanTransition(
  businessId: string,
  fromPlan: string,
  toPlan: string,
  actor: ApplyPlanTransitionActor = {}
): Promise<
  | { ok: true; scheduled: boolean; effectiveAt: string | null; subscription: any }
  | { ok: false; reason: string }
> {
  const target = await db.subscriptionPlan.findUnique({ where: { name: toPlan } });
  if (!target) return { ok: false, reason: "Plan not found" };

  const isUpgrade = planRank(toPlan) >= planRank(fromPlan);

  return db.$transaction(async (tx) => {
    const existing = await tx.businessSubscription.findUnique({
      where: { businessId },
    });

    let scheduled = false;
    let effectiveAt: Date | null = null;
    const data: Prisma.BusinessSubscriptionUncheckedUpdateInput = {
      planName: toPlan,
      monthlyFee: target.priceUsd,
      status: "active",
      downgradeScheduledFor: null,
      downgradeTargetPlan: null,
    };

    if (!isUpgrade) {
      // Downgrade — schedule at the end of the current period.
      const baseDate = existing?.endDate ?? new Date();
      const next = new Date(baseDate);
      next.setMonth(next.getMonth() + 1);
      effectiveAt = next;
      scheduled = true;
      data.downgradeScheduledFor = next;
      data.downgradeTargetPlan = toPlan;
      // The current plan stays active until `downgradeScheduledFor`.
      data.planName = fromPlan;
    }

    const subscription = existing
      ? await tx.businessSubscription.update({
          where: { id: existing.id },
          data,
        })
      : await tx.businessSubscription.create({
          data: {
            businessId,
            planName: isUpgrade ? toPlan : fromPlan,
            status: "active",
            monthlyFee: target.priceUsd,
            ...(isUpgrade ? {} : { downgradeScheduledFor: effectiveAt!, downgradeTargetPlan: toPlan }),
          },
        });

    // Update Business.plan immediately only on upgrade. On downgrade we keep
    // the current plan so quota reads stay permissive until the rollover —
    // `getEffectiveLimits` reads from `BusinessSubscription.planName`.
    if (isUpgrade) {
      await tx.business.update({
        where: { id: businessId },
        data: { plan: toPlan },
      });
    }

    await tx.activityLog.create({
      data: {
        businessId,
        userId: actor.userId ?? null,
        userName: actor.name ?? "system",
        action: scheduled
          ? "subscription_plan_change_scheduled"
          : "subscription_plan_change_applied",
        module: "subscription",
        description: scheduled
          ? `${actor.name ?? "system"} scheduled a downgrade from ${fromPlan} to ${toPlan} (effective ${effectiveAt!.toISOString()})`
          : `${actor.name ?? "system"} changed plan from ${fromPlan} to ${toPlan}`,
        metadata: {
          from: fromPlan,
          to: toPlan,
          scheduled,
          effectiveAt: effectiveAt?.toISOString() ?? null,
          actor: actor.isSuperAdmin ? "super_admin" : "tenant",
        } as any,
      },
    });

    return {
      ok: true as const,
      scheduled,
      effectiveAt: effectiveAt?.toISOString() ?? null,
      subscription,
    };
  });
}