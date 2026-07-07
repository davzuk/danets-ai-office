import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/super-admin";

// GET /api/super-admin/stats — system-wide stats for super admin dashboard
export async function GET(_req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;

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
    activeSubscriptions,
    revenueAgg,
    failedPayments,
    pendingPayments,
    paidInvoicesAgg,
    revenueByPlan,
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
    db.businessSubscription.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { planName: true, monthlyFee: true },
    }),
    db.payment.aggregate({
      where: { status: "success" },
      _sum: { amount: true },
      _count: true,
    }),
    db.payment.count({ where: { status: "failed" } }),
    db.payment.count({ where: { status: "pending" } }),
    db.invoice.aggregate({
      where: { status: "paid" },
      _sum: { amount: true },
      _count: true,
    }),
    db.payment.groupBy({
      by: ["status"],
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const mrr = activeSubscriptions.reduce((sum, s) => sum + (s.monthlyFee || 0), 0);
  const arr = mrr * 12;

  const mrrByPlan: Record<string, number> = {};
  for (const s of activeSubscriptions) {
    mrrByPlan[s.planName] = (mrrByPlan[s.planName] || 0) + (s.monthlyFee || 0);
  }

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
    revenue: {
      mrr,
      arr,
      totalRevenue: revenueAgg._sum.amount || 0,
      successfulPayments: revenueAgg._count,
      failedPayments,
      pendingPayments,
      paidInvoicesTotal: paidInvoicesAgg._sum.amount || 0,
      paidInvoicesCount: paidInvoicesAgg._count,
      mrrByPlan: Object.entries(mrrByPlan).map(([plan, amount]) => ({ plan, amount })),
      paymentsByStatus: revenueByPlan.map((p) => ({
        status: p.status,
        count: p._count,
        amount: p._sum.amount || 0,
      })),
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
