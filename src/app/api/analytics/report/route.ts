import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /api/analytics/report — comprehensive analytics with filters + CSV export
// Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const format = searchParams.get("format");

  const now = new Date();
  const from = fromParam ? new Date(fromParam) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = toParam ? new Date(toParam + "T23:59:59") : now;

  const where = { businessId: user.businessId, createdAt: { gte: from, lte: to } };

  const [
    chats,
    leads,
    tickets,
    proposals,
    aiUsage,
    leadsBySource,
    leadsByStatus,
    ticketsByStatus,
    aiByFeature,
    monthlyTrend,
  ] = await Promise.all([
    db.chatSession.count({ where }),
    db.lead.count({ where }),
    db.supportTicket.count({ where }),
    db.quoteRequest.count({ where }),
    db.aiUsageLog.aggregate({
      where,
      _sum: { totalTokens: true, costUsd: true },
      _count: true,
    }),
    db.lead.groupBy({ by: ["source"], where, _count: { _all: true } }),
    db.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.supportTicket.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.aiUsageLog.groupBy({ by: ["feature"], where, _count: { _all: true }, _sum: { totalTokens: true } }),
    db.chatSession.findMany({
      where,
      select: { createdAt: true },
      take: 5000,
    }),
  ]);

  // Build monthly trend
  const trendMap = new Map<string, { chats: number; leads: number }>();
  for (const c of monthlyTrend) {
    const key = c.createdAt.toISOString().slice(0, 7); // YYYY-MM
    const entry = trendMap.get(key) || { chats: 0, leads: 0 };
    entry.chats += 1;
    trendMap.set(key, entry);
  }
  // Add lead counts to trend
  const leadTrend = await db.lead.findMany({
    where,
    select: { createdAt: true },
    take: 5000,
  });
  for (const l of leadTrend) {
    const key = l.createdAt.toISOString().slice(0, 7);
    const entry = trendMap.get(key) || { chats: 0, leads: 0 };
    entry.leads += 1;
    trendMap.set(key, entry);
  }
  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));

  const report = {
    period: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      totalChats: chats,
      totalLeads: leads,
      totalTickets: tickets,
      totalProposals: proposals,
      aiRequests: aiUsage._count,
      aiTokens: aiUsage._sum.totalTokens || 0,
      aiCostUsd: aiUsage._sum.costUsd || 0,
      conversionRate: chats > 0 ? Math.round((leads / chats) * 100) : 0,
    },
    leadsBySource: leadsBySource.map((s) => ({ source: s.source, count: s._count._all })),
    leadsByStatus: leadsByStatus.map((s) => ({ status: s.status, count: s._count._all })),
    ticketsByStatus: ticketsByStatus.map((s) => ({ status: s.status, count: s._count._all })),
    aiByFeature: aiByFeature.map((f) => ({
      feature: f.feature,
      count: f._count._all,
      tokens: f._sum.totalTokens || 0,
    })),
    monthlyTrend: trend,
  };

  // CSV export
  if (format === "csv") {
    const headers = ["Metric", "Value"];
    const rows = [
      ["Report Period", `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`],
      ["Total Chats", String(chats)],
      ["Total Leads", String(leads)],
      ["Conversion Rate", `${report.summary.conversionRate}%`],
      ["Total Tickets", String(tickets)],
      ["Total Proposals", String(proposals)],
      ["AI Requests", String(aiUsage._count)],
      ["AI Tokens Used", String(aiUsage._sum.totalTokens || 0)],
      ["AI Cost (USD)", String((aiUsage._sum.costUsd || 0).toFixed(4))],
      ["", ""],
      ["Leads by Source", ""],
      ...leadsBySource.map((s) => [`  ${s.source}`, String(s._count._all)]),
      ["", ""],
      ["Leads by Status", ""],
      ...leadsByStatus.map((s) => [`  ${s.status}`, String(s._count._all)]),
      ["", ""],
      ["Tickets by Status", ""],
      ...ticketsByStatus.map((s) => [`  ${s.status}`, String(s._count._all)]),
      ["", ""],
      ["AI Usage by Feature", ""],
      ...aiByFeature.map((f) => [`  ${f.feature}`, `${f._count._all} requests, ${f._sum.totalTokens || 0} tokens`]),
    ];

    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
    return new NextResponse("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="analytics-report-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(report);
}
