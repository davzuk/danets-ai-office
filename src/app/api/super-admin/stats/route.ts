import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

// GET /api/super-admin/stats — system-wide stats for super admin dashboard
export async function GET(_req: NextRequest) {
  let user;
  try {
    user = await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [
    totalBusinesses,
    activeBusinesses,
    suspendedBusinesses,
    totalUsers,
    totalLeads,
    totalChats,
    totalTickets,
    totalProposals,
    aiUsageAgg,
    aiUsageCount,
    plansBreakdown,
    recentBusinesses,
  ] = await Promise.all([
    db.business.count(),
    db.business.count({ where: { status: "active" } }),
    db.business.count({ where: { status: "suspended" } }),
    db.businessUser.count(),
    db.lead.count(),
    db.chatSession.count(),
    db.supportTicket.count(),
    db.quoteRequest.count(),
    db.aiUsageLog.aggregate({ _sum: { totalTokens: true, costUsd: true } }),
    db.aiUsageLog.count(),
    db.business.groupBy({
      by: ["plan"],
      _count: { _all: true },
    }),
    db.business.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, plan: true, status: true, createdAt: true, email: true },
    }),
  ]);

  return NextResponse.json({
    totals: {
      businesses: totalBusinesses,
      activeBusinesses,
      suspendedBusinesses,
      users: totalUsers,
      leads: totalLeads,
      chats: totalChats,
      tickets: totalTickets,
      proposals: totalProposals,
      aiRequests: aiUsageCount,
      aiTokens: aiUsageAgg._sum.totalTokens || 0,
      aiCostUsd: aiUsageAgg._sum.costUsd || 0,
    },
    plansBreakdown: plansBreakdown.map((p) => ({
      plan: p.plan,
      count: p._count._all,
    })),
    recentBusinesses: recentBusinesses.map((b) => ({
      id: b.id,
      name: b.name,
      email: b.email,
      plan: b.plan,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
    })),
  });
}
