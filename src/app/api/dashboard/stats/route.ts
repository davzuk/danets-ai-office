import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";
import { computeDashboardInsights } from "@/lib/dashboard-insights";

// Cache the heavy read set per business for 60 seconds. The overview
// page hammers this endpoint every refresh, and each call used to do
// ~12 DB round trips; with the cache the same client sees one round
// trip per minute. Writes that change the dashboard numbers should
// call `revalidateDashboardStats(businessId)` (or any
// `revalidateTag("dashboard-stats")`) to flush early.
const getCachedDashboardStats = unstable_cache(
  async (businessId: string) => {
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
      dashboardInsights,
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
      computeDashboardInsights(businessId),
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
      insights: dashboardInsights.insights,
      topQuestions: dashboardInsights.topQuestions,
      leadQuality: dashboardInsights.leadQuality,
      hourly: dashboardInsights.hourly,
    };
  },
  ["dashboard-stats-v1"],
  { revalidate: 60, tags: ["dashboard-stats"] }
);

/**
 * Flush the dashboard stats cache for a business. Call this from any
 * route that mutates data the dashboard reads (new lead, new chat
 * session, AI usage log, etc.) so the user sees the change immediately
 * instead of after the 60-second window expires.
 */
export async function revalidateDashboardStats(businessId: string) {
  // Next 16 requires a profile; expire: 0 drops the entry now rather than
  // serving it stale once more.
  revalidateTag(`dashboard-stats:${businessId}`, { expire: 0 });
}

export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    return getCachedDashboardStats(user.businessId);
  });
}
