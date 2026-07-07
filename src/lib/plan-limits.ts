import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit as baseRateLimit } from "@/lib/rate-limit";

const PLAN_LIMITS: Record<string, { chatPerHour: number; aiPerDay: number; apiPerMinute: number }> = {
  free: { chatPerHour: 20, aiPerDay: 100, apiPerMinute: 30 },
  starter: { chatPerHour: 100, aiPerDay: 1000, apiPerMinute: 60 },
  pro: { chatPerHour: 500, aiPerDay: 5000, apiPerMinute: 120 },
  enterprise: { chatPerHour: 5000, aiPerDay: 50000, apiPerMinute: 300 },
};

export async function getPlanLimits(businessId: string) {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { plan: true } });
  const plan = business?.plan || "free";
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export async function checkChatRateLimit(businessId: string, identifier: string) {
  const limits = await getPlanLimits(businessId);
  const result = baseRateLimit(`chat:${businessId}:${identifier}`, limits.chatPerHour, 60 * 60 * 1000);
  return { allowed: result.success, limit: limits.chatPerHour, remaining: result.remaining };
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  window: "month";
}

// Check the monthly AI request quota for a business against the plan's
// chatLimit (used as the canonical monthly AI request cap). Falls back to
// the hardcoded plan-limits aiPerDay * 30 as an approximation when no
// SubscriptionPlan row exists.
export async function checkMonthlyAiQuota(businessId: string): Promise<QuotaResult> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { plan: true },
  });
  const planName = business?.plan || "free";
  const planRow = await db.subscriptionPlan.findUnique({ where: { name: planName } });

  const fallback = PLAN_LIMITS[planName] || PLAN_LIMITS.free;
  const limit = planRow?.chatLimit ?? fallback.aiPerDay * 30;

  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );
  const used = await db.aiUsageLog.count({
    where: {
      businessId,
      createdAt: { gte: startOfMonth },
    },
  });

  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    window: "month",
  };
}

// Throw QUOTA_EXCEEDED when the tenant's monthly AI quota is exhausted.
// apiHandler/withSession maps this to HTTP 429 with a clear message.
export async function requireAiQuota(businessId: string): Promise<QuotaResult> {
  const quota = await checkMonthlyAiQuota(businessId);
  if (!quota.allowed) {
    throw new Error("QUOTA_EXCEEDED");
  }
  return quota;
}

// Returns a 429 NextResponse for routes that use requireSession directly
// (rather than withSession) and need to bail before calling the AI.
export function quotaExceededResponse() {
  return NextResponse.json(
    {
      error:
        "Your monthly AI request quota has been reached. Please upgrade your plan to continue.",
    },
    { status: 429 }
  );
}

export function sanitizeInput(input: string, maxLength: number = 2000): string {
  if (!input) return "";
  let cleaned = input.trim().slice(0, maxLength);
  cleaned = cleaned.replace(/\0/g, "");
  cleaned = cleaned.replace(/<script[^>]*>.*?<\/script>/gi, "");
  cleaned = cleaned.replace(/on\w+\s*=\s*"[^"]*"/gi, "");
  cleaned = cleaned.replace(/on\w+\s*=\s*'[^']*'/gi, "");
  return cleaned;
}
