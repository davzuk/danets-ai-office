import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/api";

// GET /api/analytics — conversation & AI insights for the overview dashboard
export async function GET(_req: NextRequest) {
  return withSession(async (user) => {
    const businessId = user.businessId;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [sessions, messages, leads, usageLogs] = await Promise.all([
      db.chatSession.findMany({
        where: { businessId, createdAt: { gte: thirtyDaysAgo } },
        select: {
          id: true,
          status: true,
          leadQuality: true,
          createdAt: true,
          messages: {
            select: { role: true, content: true },
          },
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
        select: { quality: true, status: true, createdAt: true },
      }),
      db.aiUsageLog.findMany({
        where: { businessId, createdAt: { gte: thirtyDaysAgo } },
        select: { feature: true, status: true, totalTokens: true, createdAt: true },
      }),
    ]);

    // ── Deflection rate: % of sessions that ended without handover ──
    const totalSessions = sessions.length;
    const handoverSessions = sessions.filter((s) => s.status === "handover").length;
    const deflectionRate =
      totalSessions > 0
        ? Math.round(((totalSessions - handoverSessions) / totalSessions) * 100)
        : 0;

    // ── Lead conversion: leads / sessions ──
    const leadConversion =
      totalSessions > 0
        ? Math.round((leads.length / totalSessions) * 100)
        : 0;

    // ── Avg messages per session ──
    const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
    const avgMessages =
      totalSessions > 0 ? Math.round((totalMessages / totalSessions) * 10) / 10 : 0;

    // ── Top questions (extract user messages, normalize, count) ──
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
    // Group similar questions by first 4 words
    const grouped = new Map<string, { count: number; sample: string }>();
    for (const [q, count] of questionCounts) {
      const key = q.split(" ").slice(0, 4).join(" ");
      const existing = grouped.get(key);
      if (existing) {
        existing.count += count;
      } else {
        grouped.set(key, { count, sample: m_capitalize(q) });
      }
    }
    const topQuestions = Array.from(grouped.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((g) => ({ question: g.sample, count: g.count }));

    // ── Lead quality distribution ──
    const leadQuality = {
      high: leads.filter((l) => l.quality === "high").length,
      medium: leads.filter((l) => l.quality === "medium").length,
      low: leads.filter((l) => l.quality === "low").length,
    };

    // ── AI success rate ──
    const aiSuccess = usageLogs.filter((l) => l.status === "success").length;
    const aiErrors = usageLogs.filter((l) => l.status === "error").length;
    const aiSuccessRate =
      usageLogs.length > 0
        ? Math.round((aiSuccess / usageLogs.length) * 100)
        : 100;

    // ── Hourly activity (last 24h) for a mini heatmap ──
    const now = new Date();
    const hourly: { hour: string; count: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now.getTime() - i * 60 * 60 * 1000);
      const label = h.getHours().toString().padStart(2, "0");
      hourly.push({ hour: label, count: 0 });
    }
    const hourMap = new Map(hourly.map((h, i) => [i, h]));
    for (const s of sessions) {
      const hoursAgo = Math.floor((now.getTime() - s.createdAt.getTime()) / (60 * 60 * 1000));
      if (hoursAgo >= 0 && hoursAgo < 24) {
        const idx = 23 - hoursAgo;
        hourMap.get(idx)!.count += 1;
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
  });
}

function m_capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
