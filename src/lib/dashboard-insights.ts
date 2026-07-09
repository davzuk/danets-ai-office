import { db } from "@/lib/db";

export type DashboardInsights = {
  insights: {
    deflectionRate: number;
    leadConversion: number;
    avgMessages: number;
    aiSuccessRate: number;
    totalSessions: number;
    totalLeads: number;
    aiRequests: number;
  };
  topQuestions: { question: string; count: number }[];
  leadQuality: { high: number; medium: number; low: number };
  hourly: { hour: string; count: number }[];
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compute 30-day dashboard insights — used by overview (ungated) and analytics. */
export async function computeDashboardInsights(
  businessId: string
): Promise<DashboardInsights> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [sessions, messages, leads, usageLogs] = await Promise.all([
    db.chatSession.findMany({
      where: { businessId, createdAt: { gte: thirtyDaysAgo } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        messages: { select: { role: true } },
      },
      take: 200,
    }),
    db.chatMessage.findMany({
      where: {
        session: { businessId },
        role: "user",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { content: true },
      take: 500,
    }),
    db.lead.findMany({
      where: { businessId, createdAt: { gte: thirtyDaysAgo } },
      select: { quality: true },
    }),
    db.aiUsageLog.findMany({
      where: { businessId, createdAt: { gte: thirtyDaysAgo } },
      select: { status: true },
    }),
  ]);

  const totalSessions = sessions.length;
  const handoverSessions = sessions.filter((s) => s.status === "handover").length;
  const deflectionRate =
    totalSessions > 0
      ? Math.round(((totalSessions - handoverSessions) / totalSessions) * 100)
      : 0;

  const leadConversion =
    totalSessions > 0 ? Math.round((leads.length / totalSessions) * 100) : 0;

  const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
  const avgMessages =
    totalSessions > 0 ? Math.round((totalMessages / totalSessions) * 10) / 10 : 0;

  const questionCounts = new Map<string, number>();
  for (const m of messages) {
    const q = m.content
      .trim()
      .toLowerCase()
      .replace(/[?.!]+$/, "")
      .slice(0, 80);
    if (q.length < 3) continue;
    questionCounts.set(q, (questionCounts.get(q) || 0) + 1);
  }

  const grouped = new Map<string, { count: number; sample: string }>();
  for (const [q, count] of questionCounts) {
    const key = q.split(" ").slice(0, 4).join(" ");
    const existing = grouped.get(key);
    if (existing) existing.count += count;
    else grouped.set(key, { count, sample: capitalize(q) });
  }

  const topQuestions = Array.from(grouped.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((g) => ({ question: g.sample, count: g.count }));

  const leadQuality = {
    high: leads.filter((l) => l.quality === "high").length,
    medium: leads.filter((l) => l.quality === "medium").length,
    low: leads.filter((l) => l.quality === "low").length,
  };

  const aiSuccess = usageLogs.filter((l) => l.status === "success").length;
  const aiSuccessRate =
    usageLogs.length > 0
      ? Math.round((aiSuccess / usageLogs.length) * 100)
      : 100;

  const now = new Date();
  const hourly: { hour: string; count: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 60 * 60 * 1000);
    hourly.push({ hour: h.getHours().toString().padStart(2, "0"), count: 0 });
  }
  const hourMap = new Map(hourly.map((h, i) => [i, h]));
  for (const s of sessions) {
    const hoursAgo = Math.floor(
      (now.getTime() - s.createdAt.getTime()) / (60 * 60 * 1000)
    );
    if (hoursAgo >= 0 && hoursAgo < 24) {
      hourMap.get(23 - hoursAgo)!.count += 1;
    }
  }

  return {
    insights: {
      deflectionRate,
      leadConversion,
      avgMessages,
      aiSuccessRate,
      totalSessions,
      totalLeads: leads.length,
      aiRequests: usageLogs.length,
    },
    topQuestions,
    leadQuality,
    hourly,
  };
}
