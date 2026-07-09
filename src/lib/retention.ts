import { db } from "@/lib/db";

export interface RetentionPolicy {
  auditRetentionDays: number;
  chatRetentionDays: number;
  leadRetentionDays: number;
}

const DEFAULT_RETENTION: Record<string, RetentionPolicy> = {
  free: { auditRetentionDays: 7, chatRetentionDays: 30, leadRetentionDays: 90 },
  starter: { auditRetentionDays: 30, chatRetentionDays: 90, leadRetentionDays: 180 },
  business: { auditRetentionDays: 30, chatRetentionDays: 90, leadRetentionDays: 180 },
  pro: { auditRetentionDays: 90, chatRetentionDays: 180, leadRetentionDays: 365 },
  premium: { auditRetentionDays: 90, chatRetentionDays: 180, leadRetentionDays: 365 },
  enterprise: { auditRetentionDays: 365, chatRetentionDays: 730, leadRetentionDays: 1095 },
};

export async function getRetentionPolicy(planName: string): Promise<RetentionPolicy> {
  const plan = await db.subscriptionPlan.findUnique({
    where: { name: planName },
    select: {
      auditRetentionDays: true,
      chatRetentionDays: true,
      leadRetentionDays: true,
    },
  });

  if (plan) {
    return {
      auditRetentionDays: plan.auditRetentionDays,
      chatRetentionDays: plan.chatRetentionDays,
      leadRetentionDays: plan.leadRetentionDays,
    };
  }

  return DEFAULT_RETENTION[planName] ?? DEFAULT_RETENTION.free;
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function applyRetentionForBusiness(businessId: string) {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { plan: true, name: true },
  });
  if (!business) throw new Error("NOT_FOUND");

  const policy = await getRetentionPolicy(business.plan);

  const [auditDeleted, chatsDeleted, leadsDeleted] = await Promise.all([
    db.activityLog.deleteMany({
      where: {
        businessId,
        createdAt: { lt: daysAgo(policy.auditRetentionDays) },
      },
    }),
    db.chatSession.deleteMany({
      where: {
        businessId,
        createdAt: { lt: daysAgo(policy.chatRetentionDays) },
      },
    }),
    db.lead.deleteMany({
      where: {
        businessId,
        createdAt: { lt: daysAgo(policy.leadRetentionDays) },
      },
    }),
  ]);

  return {
    businessId,
    businessName: business.name,
    policy,
    deleted: {
      auditLogs: auditDeleted.count,
      chatSessions: chatsDeleted.count,
      leads: leadsDeleted.count,
    },
  };
}

/** Apply plan retention windows to every tenant (platform cron / bulk ops). */
export async function applyRetentionAll() {
  const businesses = await db.business.findMany({ select: { id: true } });
  const results: Array<
    Awaited<ReturnType<typeof applyRetentionForBusiness>> | { businessId: string; error: string }
  > = [];

  for (const b of businesses) {
    try {
      results.push(await applyRetentionForBusiness(b.id));
    } catch {
      results.push({ businessId: b.id, error: "failed" });
    }
  }

  return results;
}
