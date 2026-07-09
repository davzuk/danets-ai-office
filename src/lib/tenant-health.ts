import { db } from "@/lib/db";
import { getTenantUsage } from "@/lib/tenant-usage";

export type HealthLevel = "healthy" | "at_risk" | "critical";

export interface TenantHealthRow {
  businessId: string;
  businessName: string;
  plan: string;
  status: string;
  subscriptionStatus: string | null;
  score: number;
  level: HealthLevel;
  alerts: string[];
  lastActiveAt: string | null;
  usagePercent: number;
}

function levelFromScore(score: number): HealthLevel {
  if (score >= 75) return "healthy";
  if (score >= 50) return "at_risk";
  return "critical";
}

export async function computeTenantHealth(
  businessId: string,
  businessName: string,
  plan: string,
  status: string,
  subscriptionStatus: string | null
): Promise<TenantHealthRow> {
  const alerts: string[] = [];
  let score = 100;

  if (status === "suspended") {
    score -= 40;
    alerts.push("Business suspended");
  }

  if (subscriptionStatus === "past_due") {
    score -= 25;
    alerts.push("Payment past due");
  } else if (subscriptionStatus === "canceled" || subscriptionStatus === "expired") {
    score -= 35;
    alerts.push(`Subscription ${subscriptionStatus}`);
  } else if (!subscriptionStatus) {
    score -= 10;
    alerts.push("No subscription record");
  }

  const usage = await getTenantUsage(businessId, plan);
  const usagePercent = Math.max(
    usage.percent.chats,
    usage.percent.leads,
    usage.percent.kbItems,
    usage.percent.aiRequests
  );

  if (usagePercent >= 95) {
    score -= 25;
    alerts.push("Quota nearly exhausted (≥95%)");
  } else if (usagePercent >= 80) {
    score -= 12;
    alerts.push("High quota usage (≥80%)");
  }

  const lastSession = await db.session.findFirst({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const lastActiveAt = lastSession?.createdAt.toISOString() ?? null;
  if (!lastSession) {
    score -= 15;
    alerts.push("No login activity recorded");
  } else {
    const daysSince =
      (Date.now() - lastSession.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 30) {
      score -= 20;
      alerts.push("Inactive 30+ days");
    } else if (daysSince > 14) {
      score -= 10;
      alerts.push("Inactive 14+ days");
    }
  }

  score = Math.max(0, Math.min(100, score));

  return {
    businessId,
    businessName,
    plan,
    status,
    subscriptionStatus,
    score,
    level: levelFromScore(score),
    alerts,
    lastActiveAt,
    usagePercent,
  };
}
