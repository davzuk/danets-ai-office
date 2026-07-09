import {
  getEffectiveLimits,
  getQuotaUsage,
  type EffectiveLimits,
} from "@/lib/plan-quota";

export interface TenantUsageSnapshot {
  chats: number;
  leads: number;
  kbItems: number;
  agents: number;
  aiRequests: number;
  limits: EffectiveLimits & { aiLimit: number };
  percent: {
    chats: number;
    leads: number;
    kbItems: number;
    agents: number;
    aiRequests: number;
  };
}

function pct(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export async function getTenantUsage(
  businessId: string,
  planName?: string
): Promise<TenantUsageSnapshot> {
  const limits = await getEffectiveLimits(businessId, planName);
  const usage = await getQuotaUsage(businessId);

  return {
    chats: usage.chats,
    leads: usage.leads,
    kbItems: usage.kbItems,
    agents: usage.agents,
    aiRequests: usage.aiRequests,
    limits: {
      ...limits,
      aiLimit: limits.aiLimit,
    },
    percent: {
      chats: pct(usage.chats, limits.chatLimit),
      leads: pct(usage.leads, limits.leadLimit),
      kbItems: pct(usage.kbItems, limits.kbLimit),
      agents: pct(usage.agents, limits.agentLimit),
      aiRequests: pct(usage.aiRequests, limits.aiLimit),
    },
  };
}
