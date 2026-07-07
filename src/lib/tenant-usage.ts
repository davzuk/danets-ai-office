import { db } from "@/lib/db";

export interface TenantUsageSnapshot {
  chats: number;
  leads: number;
  kbItems: number;
  aiRequests: number;
  limits: {
    chatLimit: number;
    leadLimit: number;
    kbLimit: number;
    aiLimit: number;
  };
  percent: {
    chats: number;
    leads: number;
    kbItems: number;
    aiRequests: number;
  };
}

function startOfMonth() {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

function pct(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export async function getTenantUsage(businessId: string, planName?: string): Promise<TenantUsageSnapshot> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { plan: true },
  });
  const resolvedPlan = planName || business?.plan || "free";
  const planRow = await db.subscriptionPlan.findUnique({ where: { name: resolvedPlan } });

  const chatLimit = planRow?.chatLimit ?? 100;
  const leadLimit = planRow?.leadLimit ?? 50;
  const kbLimit = planRow?.kbLimit ?? 25;
  const aiLimit = chatLimit;

  const monthStart = startOfMonth();
  const [chats, leads, kbItems, aiRequests] = await Promise.all([
    db.chatSession.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.lead.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    db.knowledgeBaseItem.count({ where: { businessId } }),
    db.aiUsageLog.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
  ]);

  return {
    chats,
    leads,
    kbItems,
    aiRequests,
    limits: { chatLimit, leadLimit, kbLimit, aiLimit },
    percent: {
      chats: pct(chats, chatLimit),
      leads: pct(leads, leadLimit),
      kbItems: pct(kbItems, kbLimit),
      aiRequests: pct(aiRequests, aiLimit),
    },
  };
}
