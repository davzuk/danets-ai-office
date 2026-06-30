import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const businessId = user.businessId;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [
      totalSessions,
      totalLeads,
      newLeads,
      totalUsage,
      recentConversations,
      recentQuotes,
      topKb,
      usageByFeature,
      leadsByDay,
      sessionsByDay,
    ] = await Promise.all([
      db.chatSession.count({ where: { businessId } }),
      db.lead.count({ where: { businessId } }),
      db.lead.count({ where: { businessId, status: "new" } }),
      db.aiUsageLog.aggregate({
        where: { businessId },
        _sum: { totalTokens: true, costUsd: true },
        _count: true,
      }),
      db.chatSession.findMany({
        where: { businessId },
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } },
          lead: { select: { name: true, quality: true } },
        },
      }),
      db.quoteRequest.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { documents: { take: 1, orderBy: { createdAt: "desc" }, select: { id: true } } },
      }),
      db.knowledgeBaseItem.findMany({
        where: { businessId, status: "active" },
        orderBy: { views: "desc" },
        take: 5,
        select: { id: true, title: true, category: true, views: true },
      }),
      db.aiUsageLog.groupBy({
        by: ["feature"],
        where: { businessId },
        _count: true,
        _sum: { totalTokens: true },
      }),
      db.lead.findMany({
        where: { businessId, createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true },
      }),
      db.chatSession.findMany({
        where: { businessId, createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true },
      }),
    ]);

    // Build 7-day series
    const days: { date: string; label: string; leads: number; sessions: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfDay.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      days.push({
        date: key,
        label: d.toLocaleDateString("en-US", { weekday: "short" }),
        leads: 0,
        sessions: 0,
      });
    }
    const dayMap = new Map(days.map((d) => [d.date, d]));
    for (const l of leadsByDay) {
      const k = l.createdAt.toISOString().slice(0, 10);
      const day = dayMap.get(k);
      if (day) day.leads += 1;
    }
    for (const s of sessionsByDay) {
      const k = s.createdAt.toISOString().slice(0, 10);
      const day = dayMap.get(k);
      if (day) day.sessions += 1;
    }

    return {
      stats: {
        totalSessions,
        totalLeads,
        newLeads,
        aiUsageCount: totalUsage._count,
        aiTokens: totalUsage._sum.totalTokens || 0,
        aiCostUsd: totalUsage._sum.costUsd || 0,
      },
      recentConversations: recentConversations.map((s) => ({
        id: s.id,
        visitorName: s.visitorName,
        visitorEmail: s.visitorEmail,
        status: s.status,
        leadQuality: s.leadQuality,
        updatedAt: s.updatedAt,
        lastMessage: s.messages[0]?.content?.slice(0, 100) || "",
        leadName: s.lead?.name,
      })),
      recentQuotes: recentQuotes.map((q) => ({
        id: q.id,
        clientName: q.clientName,
        companyName: q.companyName,
        service: q.service,
        status: q.status,
        createdAt: q.createdAt,
        hasDocument: q.documents.length > 0,
      })),
      topKb,
      usageByFeature: usageByFeature.map((u) => ({
        feature: u.feature,
        count: u._count,
        tokens: u._sum.totalTokens || 0,
      })),
      series: days,
    };
  });
}
