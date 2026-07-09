import { db } from "@/lib/db";

export type QuotaResource = "leads" | "kbItems" | "agents" | "chats" | "aiRequests";

export interface EffectiveLimits {
  plan: string;
  hasOverride: boolean;
  chatLimit: number;
  leadLimit: number;
  kbLimit: number;
  agentLimit: number;
  aiLimit: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resource: QuotaResource;
}

const FALLBACK_AGENT_LIMITS: Record<string, number> = {
  free: 1,
  starter: 3,
  business: 3,
  pro: 999,
  premium: 999,
  enterprise: 9999,
};

const RESOURCE_LABELS: Record<QuotaResource, string> = {
  leads: "monthly leads",
  kbItems: "knowledge base items",
  agents: "AI agents",
  chats: "monthly chats",
  aiRequests: "monthly AI requests",
};

export class LimitExceededError extends Error {
  readonly resource: QuotaResource;
  readonly limit: number;
  readonly used: number;

  constructor(resource: QuotaResource, limit: number, used: number) {
    super(`LIMIT_EXCEEDED:${resource}:${limit}`);
    this.resource = resource;
    this.limit = limit;
    this.used = used;
  }

  get label() {
    return RESOURCE_LABELS[this.resource];
  }
}

function startOfMonth() {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

export async function getEffectiveLimits(
  businessId: string,
  planName?: string
): Promise<EffectiveLimits> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { plan: true, limitOverride: true },
  });

  const plan = planName || business?.plan || "free";
  const planRow = await db.subscriptionPlan.findUnique({ where: { name: plan } });
  const override = business?.limitOverride;

  const baseChat = planRow?.chatLimit ?? 100;
  const base = {
    chatLimit: baseChat,
    leadLimit: planRow?.leadLimit ?? 50,
    kbLimit: planRow?.kbLimit ?? 25,
    agentLimit: planRow?.agentLimit ?? FALLBACK_AGENT_LIMITS[plan] ?? 1,
  };

  return {
    plan,
    hasOverride: !!override,
    chatLimit: override?.chatLimit ?? base.chatLimit,
    leadLimit: override?.leadLimit ?? base.leadLimit,
    kbLimit: override?.kbLimit ?? base.kbLimit,
    agentLimit: override?.agentLimit ?? base.agentLimit,
    aiLimit: override?.chatLimit ?? base.chatLimit,
  };
}

export async function getQuotaUsage(businessId: string) {
  const monthStart = startOfMonth();
  const [chats, leads, kbItems, agents, aiRequests] = await Promise.all([
    db.chatSession.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.lead.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.knowledgeBaseItem.count({ where: { businessId } }),
    db.aiAgent.count({ where: { businessId } }),
    db.aiUsageLog.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
  ]);

  return { chats, leads, kbItems, agents, aiRequests };
}

function limitForResource(
  limits: EffectiveLimits,
  resource: QuotaResource
): number {
  switch (resource) {
    case "leads":
      return limits.leadLimit;
    case "kbItems":
      return limits.kbLimit;
    case "agents":
      return limits.agentLimit;
    case "chats":
      return limits.chatLimit;
    case "aiRequests":
      return limits.aiLimit;
  }
}

function usedForResource(
  usage: Awaited<ReturnType<typeof getQuotaUsage>>,
  resource: QuotaResource
): number {
  switch (resource) {
    case "leads":
      return usage.leads;
    case "kbItems":
      return usage.kbItems;
    case "agents":
      return usage.agents;
    case "chats":
      return usage.chats;
    case "aiRequests":
      return usage.aiRequests;
  }
}

export async function checkQuota(
  businessId: string,
  resource: QuotaResource,
  additionalCount = 1
): Promise<QuotaCheckResult> {
  const limits = await getEffectiveLimits(businessId);
  const usage = await getQuotaUsage(businessId);
  const limit = limitForResource(limits, resource);
  const used = usedForResource(usage, resource);

  // 0 or negative limit = unlimited
  if (limit <= 0) {
    return { allowed: true, used, limit, remaining: Infinity, resource };
  }

  const remaining = Math.max(0, limit - used);
  const allowed = used + additionalCount <= limit;

  return { allowed, used, limit, remaining, resource };
}

export async function requireQuota(
  businessId: string,
  resource: QuotaResource,
  additionalCount = 1
): Promise<QuotaCheckResult> {
  const result = await checkQuota(businessId, resource, additionalCount);
  if (!result.allowed) {
    throw new LimitExceededError(resource, result.limit, result.used);
  }
  return result;
}

export function formatLimitExceededMessage(err: LimitExceededError): string {
  return `You have reached your plan limit for ${err.label} (${err.used.toLocaleString()} / ${err.limit.toLocaleString()}). Please upgrade your plan.`;
}
