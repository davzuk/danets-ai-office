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

export function sanitizeInput(input: string, maxLength: number = 2000): string {
  if (!input) return "";
  let cleaned = input.trim().slice(0, maxLength);
  cleaned = cleaned.replace(/\0/g, "");
  cleaned = cleaned.replace(/<script[^>]*>.*?<\/script>/gi, "");
  cleaned = cleaned.replace(/on\w+\s*=\s*"[^"]*"/gi, "");
  cleaned = cleaned.replace(/on\w+\s*=\s*'[^']*'/gi, "");
  return cleaned;
}
